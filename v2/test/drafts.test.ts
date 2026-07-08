import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeAdapter, type FakeAdapter } from '../src/adapters/fake.js';
import type { Coach } from '../src/agents/coach.js';
import { createAutonomyPolicy } from '../src/approval/autonomy.js';
import { createDraftService, StaleDraftError, type DraftService } from '../src/approval/drafts.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { ActiveDraftExistsError, createDraftRepo, type DraftRepo } from '../src/repos/draftRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { createPromptStore } from '../src/repos/promptStore.js';
import type { Draft } from '../src/repos/types.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;
let messages: MessageRepo;
let drafts: DraftRepo;
let adapter: FakeAdapter;
let service: DraftService;
let clientId: string;

/** Coach stub: DraftService's contract with the coach is just draft(clientId) → Draft. */
const stubCoach: Coach = {
  draft: (cid) =>
    Promise.resolve(
      drafts.create({
        clientId: cid,
        coversThroughMessageId: messages.latestInbound(cid)!.id,
        draftText: 'Yes, direct 1-to-1 swap.',
        responseType: 'coaching_answer',
        confidence: 0.9,
      })
    ),
};

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  drafts = createDraftRepo(ctx.db, ctx.clock, audit);
  adapter = createFakeAdapter();
  service = createDraftService({ db: ctx.db, clients, messages, drafts, coach: stubCoach, adapter });

  const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
  clients.verify(c.id);
  clients.registerIdentity(c.id, 'fake', 'ext-1');
  clientId = c.id;
  messages.appendInbound({ clientId, text: 'can I swap rice?' });
});
afterEach(() => ctx.cleanup());

describe('triggerDraft guards', () => {
  it('refuses a second active draft, an inactive client, and an empty conversation', async () => {
    await service.triggerDraft(clientId);
    await expect(service.triggerDraft(clientId)).rejects.toThrow(ActiveDraftExistsError);

    const pending = clients.create({ displayName: 'Stranger', timezone: 'UTC' });
    await expect(service.triggerDraft(pending.id)).rejects.toThrow(/active/);
  });
});

describe('send', () => {
  let draft: Draft;
  beforeEach(async () => {
    draft = await service.triggerDraft(clientId);
  });

  it('delivers via the adapter, records sent + outbound row, audits unedited', async () => {
    await service.send(draft.id);

    expect(adapter.sent).toEqual([{ externalId: 'ext-1', text: 'Yes, direct 1-to-1 swap.' }]);
    const sent = drafts.get(draft.id)!;
    expect(sent.status).toBe('sent');
    expect(sent.finalText).toBe('Yes, direct 1-to-1 swap.');

    const outbound = messages.list(clientId)[0]!;
    expect(outbound.direction).toBe('outbound');
    expect(outbound.draftId).toBe(draft.id);

    const event = audit.listEvents({ clientId }).find((e) => e.action === 'draft_sent')!;
    expect((event.details as { edited: boolean }).edited).toBe(false);
  });

  it('records the operator edit as final_text with the edited flag', async () => {
    await service.send(draft.id, 'Yes — same portion size though.');
    expect(drafts.get(draft.id)!.finalText).toBe('Yes — same portion size though.');
    expect(adapter.sent[0]!.text).toBe('Yes — same portion size though.');
    const event = audit.listEvents({ clientId }).find((e) => e.action === 'draft_sent')!;
    expect((event.details as { edited: boolean }).edited).toBe(true);
  });

  it('freshness race (D19): a newer inbound blocks the send, nothing delivered', async () => {
    messages.appendInbound({ clientId, text: 'oh also — one more thing' });

    await expect(service.send(draft.id)).rejects.toThrow(StaleDraftError);
    expect(drafts.get(draft.id)!.status).toBe('stale');
    expect(adapter.sent).toEqual([]); // the invariant: never a reply that predates the client

    // and a fresh draft can now be triggered
    await expect(service.triggerDraft(clientId)).resolves.toBeDefined();
  });

  it('refuses to re-send a resolved draft', async () => {
    await service.send(draft.id);
    await expect(service.send(draft.id)).rejects.toThrow(/status 'sent'/);
  });

  it('reject retains the draft as rejected', async () => {
    service.reject(draft.id);
    expect(drafts.get(draft.id)!.status).toBe('rejected');
  });
});

describe('autonomy policy (fail closed)', () => {
  it('reads configured levels; unknown types and malformed yaml → level 0', () => {
    const dir = join(ctx.dir, 'prompts');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'autonomy.yaml'),
      'autonomy:\n  gm_ack: { level: 1, auto_send_min_confidence: 0.9 }\n'
    );
    const policy = createAutonomyPolicy({ prompts: createPromptStore({ promptsDir: dir }) });
    expect(policy.levelFor('gm_ack')).toEqual({ level: 1, autoSendMinConfidence: 0.9 });
    expect(policy.levelFor('coaching_answer').level).toBe(0); // absent → closed
    expect(policy.levelFor('nonsense_type').level).toBe(0);

    writeFileSync(join(dir, 'autonomy.yaml'), '{{{{ not yaml');
    expect(policy.levelFor('gm_ack').level).toBe(0); // malformed → closed
  });
});
