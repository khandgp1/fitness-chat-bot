import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo } from '../src/repos/clientRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let messages: MessageRepo;
let clientId: string;

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  const clients = createClientRepo(ctx.db, ctx.clock, audit);
  clientId = clients.create({ displayName: 'Mike', timezone: 'UTC' }).id;
});
afterEach(() => ctx.cleanup());

describe('messages', () => {
  it('pages newest-first with beforeId', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'].map(
      (t) => messages.appendInbound({ clientId, text: t }).id
    );
    const page1 = messages.list(clientId, { limit: 2 });
    expect(page1.map((m) => m.text)).toEqual(['e', 'd']);
    const page2 = messages.list(clientId, { beforeId: page1[1]!.id, limit: 2 });
    expect(page2.map((m) => m.text)).toEqual(['c', 'b']);
    expect(ids.length).toBe(5);
  });

  it('latestInbound ignores outbound', () => {
    messages.appendInbound({ clientId, text: 'GM' });
    messages.appendOutbound({ clientId, text: 'Morning.' });
    expect(messages.latestInbound(clientId)?.text).toBe('GM');
  });
});

describe('batches', () => {
  it('keeps one open batch per client', () => {
    const b1 = messages.openBatch(clientId);
    const b2 = messages.openBatch(clientId);
    expect(b2.id).toBe(b1.id);
    messages.closeBatch(b1.id);
    const b3 = messages.openBatch(clientId);
    expect(b3.id).not.toBe(b1.id);
  });

  it('walks open → pending → processed with router fields', () => {
    const b = messages.openBatch(clientId);
    expect(() =>
      messages.markBatchProcessed(b.id, {
        primaryIntent: 'gm_checkin',
        routerConfidence: 0.9,
        needsResponse: false,
      })
    ).toThrow(/not pending/);

    messages.closeBatch(b.id);
    expect(() => messages.closeBatch(b.id)).toThrow(/not open/);

    messages.markBatchProcessed(b.id, {
      primaryIntent: 'coaching_question',
      routerConfidence: 0.85,
      needsResponse: true,
    });
    const processed = messages.getBatch(b.id)!;
    expect(processed.status).toBe('processed');
    expect(processed.primaryIntent).toBe('coaching_question');
    expect(processed.needsResponse).toBe(true);
    expect(processed.processedAt).toBeDefined();
  });

  it('dismiss stamps dismissed_at and audits', () => {
    const b = messages.openBatch(clientId);
    messages.dismissBatch(b.id);
    expect(messages.getBatch(b.id)?.dismissedAt).toBeDefined();
    expect(audit.listEvents({ clientId }).map((e) => e.action)).toContain('batch_dismissed');
  });
});
