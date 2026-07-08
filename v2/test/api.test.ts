import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeAdapter, type FakeAdapter } from '../src/adapters/fake.js';
import { createFakeLlmClient, type FakeLlmClient } from '../src/agents/llmClient.js';
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config/config.js';

let dir: string;
let app: App;
let adapter: FakeAdapter;
let llm: FakeLlmClient;
let base: string;
let cookie: string;
let clientId: string;

async function api(path: string, init: RequestInit = {}, withAuth = true): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie } : {}),
      ...init.headers,
    },
  });
}
const post = (path: string, body?: unknown) =>
  api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

const DRAFT_TURN = [
  {
    type: 'tool_use' as const,
    id: 'tu-1',
    name: 'draft_response',
    input: { text: 'Deload is fine this week.', response_type: 'coaching_answer', confidence: 0.85 },
  },
];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'api-test-'));
  adapter = createFakeAdapter();
  llm = createFakeLlmClient();
  const cfg = loadConfig({
    DB_PATH: join(dir, 'api.sqlite'),
    NARRATIVES_DIR: join(dir, 'narratives'),
    PROMPTS_DIR: 'prompts', // real seeded prompts (read-only here)
    ADMIN_TOKEN: 'secret-token',
    PORT: '0',
    DEBOUNCE_MINUTES: '60',
    STALENESS_THRESHOLD_EXCHANGES: '2',
  });
  app = buildApp({ cfg, adapter, llm });
  await app.start();
  base = `http://localhost:${app.apiPort()}`;

  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'secret-token' }),
  });
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;

  const c = app.deps.clients.create({ displayName: 'Mike', timezone: 'UTC' });
  app.deps.clients.verify(c.id);
  app.deps.clients.registerIdentity(c.id, 'fake', 'ext-1');
  clientId = c.id;
  app.deps.messages.appendInbound({ clientId, text: 'should I deload this week?' });
});
afterEach(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth', () => {
  it('401 without a session; bad token rejected; good token issues a working cookie', async () => {
    expect((await api('/api/triage', {}, false)).status).toBe(401);
    const bad = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    expect(bad.status).toBe(401);
    expect((await api('/api/triage')).status).toBe(200);
  });

  it('start() refuses without ADMIN_TOKEN', async () => {
    const cfg = loadConfig({ DB_PATH: join(dir, 'x.sqlite'), NARRATIVES_DIR: join(dir, 'n'), PORT: '0' });
    const bare = buildApp({ cfg, adapter: createFakeAdapter(), llm: createFakeLlmClient() });
    await expect(bare.start()).rejects.toThrow(/ADMIN_TOKEN/);
    await bare.stop();
  });
});

describe('triage: items appear when seeded and clear after their action', () => {
  it('unverified contact → verify clears it', async () => {
    app.deps.ingestor.handle({ channel: 'dev', externalId: 'stranger-9', text: 'hi coach' });
    const items = (await (await api('/api/triage')).json()) as Array<{ type: string; clientId: string }>;
    const item = items.find((i) => i.type === 'unverified')!;
    expect(item).toBeDefined();

    expect((await post(`/api/clients/${item.clientId}/verify`)).status).toBe(200);
    const after = (await (await api('/api/triage')).json()) as Array<{ type: string }>;
    expect(after.find((i) => i.type === 'unverified')).toBeUndefined();
  });

  it('awaiting_response appears for a reply-worthy batch; dismiss clears it (audited)', async () => {
    const m = app.deps.messages.latestInbound(clientId)!;
    const b = app.deps.messages.openBatch(clientId);
    app.deps.messages.assignToBatch(m.id, b.id);
    app.deps.messages.closeBatch(b.id);
    app.deps.messages.markBatchProcessed(b.id, {
      primaryIntent: 'coaching_question',
      routerConfidence: 0.9,
      needsResponse: true,
    });

    const items = (await (await api('/api/triage')).json()) as Array<{ type: string; refs: { batchId?: string } }>;
    const item = items.find((i) => i.type === 'awaiting_response')!;
    expect(item.refs.batchId).toBe(b.id);

    await post(`/api/batches/${b.id}/dismiss`);
    const after = (await (await api('/api/triage')).json()) as Array<{ type: string }>;
    expect(after.find((i) => i.type === 'awaiting_response')).toBeUndefined();
    expect(app.deps.audit.listEvents({ clientId }).map((e) => e.action)).toContain('batch_dismissed');
  });

  it('miss follow-up + pending review + staleness all assemble', async () => {
    app.deps.compliance.upsertDay({ clientId, date: '2026-07-05', status: 'miss', streakAfter: 0, followupState: 'pending' });
    app.deps.compliance.upsertDay({ clientId, date: '2026-07-06', status: 'pending_review' });
    app.deps.narratives.addFlag(clientId, 'note 1', 'agent');
    app.deps.narratives.addFlag(clientId, 'note 2', 'agent');

    const items = (await (await api('/api/triage')).json()) as Array<{ type: string }>;
    const types = items.map((i) => i.type);
    expect(types).toContain('miss_followup');
    expect(types).toContain('pending_review');
    expect(types).toContain('narrative_staleness');

    await post(`/api/followups/${clientId}/2026-07-05`, { state: 'dismissed' });
    const after = (await (await api('/api/triage')).json()) as Array<{ type: string }>;
    expect(after.map((i) => i.type)).not.toContain('miss_followup');
  });
});

describe('draft round-trip over HTTP', () => {
  it('trigger → edit → send lands on the adapter; second trigger 409s while active', async () => {
    llm.enqueueTurn(DRAFT_TURN);
    const draft = (await (await post(`/api/clients/${clientId}/drafts`)).json()) as { id: string; draftText: string };
    expect(draft.draftText).toContain('Deload');

    expect((await post(`/api/clients/${clientId}/drafts`)).status).toBe(409);

    await post(`/api/drafts/${draft.id}/send`, { text: 'Deload — same lifts, 60% loads.' });
    expect(adapter.sent).toEqual([{ externalId: 'ext-1', text: 'Deload — same lifts, 60% loads.' }]);
  });

  it('stale send → 409 with a human message', async () => {
    llm.enqueueTurn(DRAFT_TURN);
    const draft = (await (await post(`/api/clients/${clientId}/drafts`)).json()) as { id: string };
    app.deps.messages.appendInbound({ clientId, text: 'actually, one more thing' });

    const res = await post(`/api/drafts/${draft.id}/send`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/stale/i);
    expect(adapter.sent).toEqual([]);
  });
});

describe('admin actions', () => {
  it('compliance correction recomputes streaks over HTTP', async () => {
    for (const [date, streak] of [['2026-07-05', 1], ['2026-07-06', 2], ['2026-07-07', 3]] as const) {
      app.deps.compliance.upsertDay({ clientId, date, status: 'compliant', streakAfter: streak });
    }
    await post(`/api/compliance/${clientId}/2026-07-06/correct`, { status: 'miss' });
    expect(app.deps.compliance.currentStreak(clientId)).toBe(1);
  });

  it('narrative quick-edit persists and reset is audited', async () => {
    await api(`/api/clients/${clientId}/narrative`, {
      method: 'PUT',
      body: JSON.stringify({ content: '## Snapshot\nDeload week.\n' }),
    });
    const detail = (await (await api(`/api/clients/${clientId}`)).json()) as { narrative: string };
    expect(detail.narrative).toContain('Deload week.');

    await post(`/api/clients/${clientId}/reset`);
    expect(app.deps.messages.list(clientId)).toHaveLength(0);
    expect(app.deps.audit.listEvents({ clientId }).map((e) => e.action)).toContain('reset');
  });
});

describe('static SPA', () => {
  it('serves the built UI unauthenticated (data stays behind the API)', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Coach Admin');
  });

  it('SPA fallback serves index.html for unknown paths (regression: dot-segment repo path)', async () => {
    const res = await fetch(`${base}/some/deep/link`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Coach Admin');
  });
});

describe('dev routes', () => {
  it('simulated inbound flows through real ingest for an existing client', async () => {
    const res = (await (
      await post('/api/dev/inbound', { clientId, text: 'GM from the dev panel' })
    ).json()) as { gated: string };
    expect(res.gated).toBe('batched');
    expect(app.deps.messages.list(clientId)[0]!.text).toBe('GM from the dev panel');
  });

  it('404 when devMode=false', async () => {
    const cfg = loadConfig({
      DB_PATH: join(dir, 'prod.sqlite'),
      NARRATIVES_DIR: join(dir, 'n2'),
      ADMIN_TOKEN: 'secret-token',
      PORT: '0',
      DEV_MODE: 'false',
    });
    const prod = buildApp({ cfg, adapter: createFakeAdapter(), llm: createFakeLlmClient() });
    await prod.start();
    const prodBase = `http://localhost:${prod.apiPort()}`;
    const login = await fetch(`${prodBase}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'secret-token' }),
    });
    const prodCookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const res = await fetch(`${prodBase}/api/dev/clock`, { headers: { cookie: prodCookie } });
    expect(res.status).toBe(404);
    await prod.stop();
  });
});
