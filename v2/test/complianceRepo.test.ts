import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo } from '../src/repos/clientRepo.js';
import { createComplianceRepo, type ComplianceRepo } from '../src/repos/complianceRepo.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let compliance: ComplianceRepo;
let clientId: string;

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  compliance = createComplianceRepo(ctx.db, ctx.clock, audit);
  const clients = createClientRepo(ctx.db, ctx.clock, audit);
  clientId = clients.create({ displayName: 'Mike', timezone: 'UTC' }).id;
});
afterEach(() => ctx.cleanup());

describe('currentStreak derivation (P2-4)', () => {
  it('is 0 with no history', () => {
    expect(compliance.currentStreak(clientId)).toBe(0);
  });

  it('returns streak_after of the latest resolved day and skips pending holds', () => {
    compliance.upsertDay({ clientId, date: '2026-07-01', status: 'compliant', streakAfter: 1 });
    compliance.upsertDay({ clientId, date: '2026-07-02', status: 'compliant', streakAfter: 2 });
    expect(compliance.currentStreak(clientId)).toBe(2);

    // pending review: NULL streak_after — the hold falls out of the query
    compliance.upsertDay({ clientId, date: '2026-07-03', status: 'pending_review' });
    expect(compliance.currentStreak(clientId)).toBe(2);

    // a later miss resets
    compliance.upsertDay({ clientId, date: '2026-07-04', status: 'miss', streakAfter: 0 });
    expect(compliance.currentStreak(clientId)).toBe(0);
  });
});

describe('day primitives', () => {
  it('upsert overwrites, listDays ranges inclusively', () => {
    compliance.upsertDay({ clientId, date: '2026-07-02', status: 'unknown' });
    compliance.upsertDay({ clientId, date: '2026-07-02', status: 'compliant', streakAfter: 1 });
    compliance.upsertDay({ clientId, date: '2026-07-03', status: 'miss', streakAfter: 0 });

    expect(compliance.getDay(clientId, '2026-07-02')?.status).toBe('compliant');
    const days = compliance.listDays(clientId, '2026-07-02', '2026-07-03');
    expect(days.map((d) => d.date)).toEqual(['2026-07-02', '2026-07-03']);
  });

  it('followup state transitions are audited and pending list works', () => {
    compliance.upsertDay({
      clientId,
      date: '2026-07-03',
      status: 'miss',
      streakAfter: 0,
      followupState: 'pending',
    });
    expect(compliance.listFollowupsPending().map((d) => d.date)).toEqual(['2026-07-03']);

    compliance.setFollowupState(clientId, '2026-07-03', 'dismissed');
    expect(compliance.listFollowupsPending()).toEqual([]);
    expect(audit.listEvents({ clientId }).map((e) => e.action)).toContain('miss_followup_dismissed');
    expect(() => compliance.setFollowupState(clientId, '2026-01-01', 'handled')).toThrow(/No compliance day/);
  });
});
