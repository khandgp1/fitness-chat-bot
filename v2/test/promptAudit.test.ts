import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo } from '../src/repos/clientRepo.js';
import { createPromptStore } from '../src/repos/promptStore.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
});
afterEach(() => ctx.cleanup());

describe('PromptStore', () => {
  it('returns content + blob hash; hash tracks content, not time', () => {
    const dir = join(ctx.dir, 'prompts');
    mkdirSync(dir);
    writeFileSync(join(dir, 'router.md'), 'You route messages.\n');
    const store = createPromptStore({ promptsDir: dir });

    const a = store.get('router.md');
    const b = store.get('router.md');
    expect(a.content).toBe('You route messages.\n');
    expect(a.gitHash).toBe(b.gitHash);
    expect(a.gitHash).toMatch(/^[0-9a-f]{40,64}$/);

    writeFileSync(join(dir, 'router.md'), 'You route messages carefully.\n');
    expect(store.get('router.md').gitHash).not.toBe(a.gitHash);
  });

  it('throws a clear error for a missing file', () => {
    const store = createPromptStore({ promptsDir: join(ctx.dir, 'prompts') });
    expect(() => store.get('nope.md')).toThrow(/Prompt file not found/);
  });
});

describe('AuditRepo', () => {
  it('filters by client and respects limit, newest first', () => {
    const clients = createClientRepo(ctx.db, ctx.clock, audit);
    const c1 = clients.create({ displayName: 'A', timezone: 'UTC' });
    const c2 = clients.create({ displayName: 'B', timezone: 'UTC' });
    audit.event({ clientId: c1.id, actor: 'system', action: 'one' });
    audit.event({ clientId: c1.id, actor: 'system', action: 'two' });
    audit.event({ clientId: c2.id, actor: 'operator', action: 'three' });

    const c1Events = audit.listEvents({ clientId: c1.id });
    expect(c1Events.map((e) => e.action)).toEqual(['two', 'one']);
    expect(audit.listEvents({ limit: 1 }).map((e) => e.action)).toEqual(['three']);
  });

  it('records llm calls with JSON result round-trip', () => {
    audit.llmCall({
      agent: 'router',
      model: 'claude-haiku-4-5',
      inputTokens: 120,
      outputTokens: 30,
      latencyMs: 450,
      result: { primary_intent: 'gm_checkin', needs_response: false },
    });
    const calls = audit.listLlmCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe('claude-haiku-4-5');
    expect((calls[0]!.result as { primary_intent: string }).primary_intent).toBe('gm_checkin');
  });
});
