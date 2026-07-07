import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo } from '../src/repos/clientRepo.js';
import {
  ActiveDraftExistsError,
  createDraftRepo,
  type DraftRepo,
} from '../src/repos/draftRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let drafts: DraftRepo;
let messages: MessageRepo;
let clientId: string;
let firstMessageId: string;

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  drafts = createDraftRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  const clients = createClientRepo(ctx.db, ctx.clock, audit);
  clientId = clients.create({ displayName: 'Mike', timezone: 'UTC' }).id;
  firstMessageId = messages.appendInbound({ clientId, text: 'can I swap rice?' }).id;
});
afterEach(() => ctx.cleanup());

const makeDraft = () =>
  drafts.create({
    clientId,
    coversThroughMessageId: firstMessageId,
    draftText: 'Yes, 1-to-1 swap.',
    responseType: 'coaching_answer',
    confidence: 0.9,
  });

describe('one active draft per client', () => {
  it('throws the typed error on a second create, allows one after resolution', () => {
    makeDraft();
    expect(() => makeDraft()).toThrow(ActiveDraftExistsError);
    const active = drafts.getActive(clientId)!;
    drafts.markStale(active.id);
    expect(() => makeDraft()).not.toThrow();
  });
});

describe('freshness (D19)', () => {
  it('is fresh until a newer inbound lands; outbound does not affect it', () => {
    const d = makeDraft();
    expect(drafts.isFresh(d)).toBe(true);
    messages.appendOutbound({ clientId, text: 'unrelated outbound' });
    expect(drafts.isFresh(d)).toBe(true);
    messages.appendInbound({ clientId, text: 'also — one more thing' });
    expect(drafts.isFresh(d)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('markSent stores final_text, stamps resolved_at, audits the edit signal', () => {
    const d = makeDraft();
    drafts.markSent(d.id, 'Yes — direct 1-to-1 swap, same portion.');
    const sent = drafts.get(d.id)!;
    expect(sent.status).toBe('sent');
    expect(sent.finalText).toBe('Yes — direct 1-to-1 swap, same portion.');
    expect(sent.resolvedAt).toBeDefined();
    const event = audit.listEvents({ clientId }).find((e) => e.action === 'draft_sent')!;
    expect((event.details as { edited: boolean }).edited).toBe(true);
  });

  it('rejected and stale drafts are retained, and cannot be sent', () => {
    const d1 = makeDraft();
    drafts.markRejected(d1.id);
    expect(() => drafts.markSent(d1.id, 'x')).toThrow(/status 'rejected'/);

    const d2 = makeDraft();
    drafts.markStale(d2.id);

    expect(drafts.list(clientId).map((d) => d.status).sort()).toEqual(['rejected', 'stale']);
  });
});
