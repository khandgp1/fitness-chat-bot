import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../src/clock/clock.js';
import { createContextBuilder, UNANSWERED_MARKER } from '../src/pipeline/context.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createComplianceRepo } from '../src/repos/complianceRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { createNarrativeStore, type NarrativeStore } from '../src/repos/narrativeStore.js';
import { join } from 'node:path';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let clients: ClientRepo;
let messages: MessageRepo;
let narratives: NarrativeStore;
let audit: AuditRepo;
let clientId: string;

function builder(opts?: { maxMessages?: number; maxDays?: number }) {
  return createContextBuilder(
    {
      clock: ctx.clock,
      clients,
      messages,
      compliance: createComplianceRepo(ctx.db, ctx.clock, audit),
      narratives,
    },
    { maxMessages: opts?.maxMessages ?? 30, maxDays: opts?.maxDays ?? 14 }
  );
}

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  narratives = createNarrativeStore(ctx.db, ctx.clock, audit, {
    narrativesDir: join(ctx.dir, 'narratives'),
  });
  const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
  clients.verify(c.id);
  clientId = c.id;
});
afterEach(() => ctx.cleanup());

describe('ContextBuilder', () => {
  it('respects the message-count limit (drops oldest)', () => {
    for (const t of ['one', 'two', 'three', 'four', 'five']) {
      messages.appendInbound({ clientId, text: t });
      ctx.clock.advance(HOUR_MS);
    }
    const text = builder({ maxMessages: 3 }).build(clientId);
    expect(text).toContain('five');
    expect(text).toContain('three');
    expect(text).not.toContain('CLIENT: one');
  });

  it('respects the age limit', () => {
    messages.appendInbound({ clientId, text: 'ancient history' });
    ctx.clock.advance(20 * DAY_MS);
    messages.appendInbound({ clientId, text: 'recent' });
    const text = builder({ maxDays: 14 }).build(clientId);
    expect(text).toContain('recent');
    expect(text).not.toContain('ancient history');
  });

  it('marks the unanswered span after the last outbound', () => {
    messages.appendInbound({ clientId, text: 'question A' });
    messages.appendOutbound({ clientId, text: 'answer A' });
    messages.appendInbound({ clientId, text: 'question B' });
    const text = builder().build(clientId);

    const marker = text.indexOf(UNANSWERED_MARKER);
    expect(marker).toBeGreaterThan(text.indexOf('answer A'));
    expect(marker).toBeLessThan(text.indexOf('question B'));
  });

  it('states a missing narrative explicitly, includes an existing one', () => {
    expect(builder().build(clientId)).toContain('(no narrative on file');
    narratives.quickEdit(clientId, '## Snapshot\nNight-shift nurse.\n', 'operator');
    expect(builder().build(clientId)).toContain('Night-shift nurse.');
  });

  it('includes streak and today status', () => {
    const text = builder().build(clientId);
    expect(text).toContain('current streak: 0');
    expect(text).toMatch(/today \(2026-07-07\): unknown/);
  });
});
