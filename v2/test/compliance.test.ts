import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS } from '../src/clock/clock.js';
import { createComplianceEngine, dateAdd, type ComplianceEngine } from '../src/domain/compliance.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createComplianceRepo, type ComplianceRepo } from '../src/repos/complianceRepo.js';
import type { ComplianceStatus } from '../src/repos/types.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

// Test clock starts 2026-07-07T12:00:00Z → client (UTC) day one is 2026-07-07.
const DAY_ONE = '2026-07-07';

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;
let compliance: ComplianceRepo;
let engine: ComplianceEngine;
let clientId: string;

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  compliance = createComplianceRepo(ctx.db, ctx.clock, audit);
  engine = createComplianceEngine({ db: ctx.db, clock: ctx.clock, clients, compliance, audit });
  const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
  clients.verify(c.id);
  clientId = c.id;
});
afterEach(() => ctx.cleanup());

/**
 * Replay DSL: one token per day, starting on DAY_ONE.
 *   gm       valid GM        fail      classification failure
 *   gm+gm    duplicate GMs   fail+gm   failure then same-day GM
 *   none     silent day (no touch — closed by a later reconcile)
 * After the last day, one more day starts and reconcile() closes history.
 */
function play(days: string[]): void {
  for (const token of days) {
    for (const action of token.split('+')) {
      if (action === 'gm') engine.recordValidGm(clientId);
      else if (action === 'fail') engine.recordClassificationFailure(clientId);
      else if (action !== 'none') throw new Error(`Unknown action: ${action}`);
    }
    ctx.clock.advance(DAY_MS);
  }
  engine.reconcile(clientId);
}

function statuses(count: number): Array<{ status: ComplianceStatus | 'absent'; streak?: number }> {
  return Array.from({ length: count }, (_, i) => {
    const day = compliance.getDay(clientId, dateAdd(DAY_ONE, i));
    return day === undefined
      ? { status: 'absent' as const }
      : { status: day.status, streak: day.streakAfter };
  });
}

describe('replay: same-day transitions', () => {
  it('three GMs build a streak of 3', () => {
    play(['gm', 'gm', 'gm']);
    expect(statuses(3)).toEqual([
      { status: 'compliant', streak: 1 },
      { status: 'compliant', streak: 2 },
      { status: 'compliant', streak: 3 },
    ]);
    expect(compliance.currentStreak(clientId)).toBe(3);
  });

  it('a miss resets: gm, none, gm → 1, 0, 1', () => {
    play(['gm', 'none', 'gm']);
    expect(statuses(3)).toEqual([
      { status: 'compliant', streak: 1 },
      { status: 'miss', streak: 0 },
      { status: 'compliant', streak: 1 },
    ]);
    const missDay = compliance.getDay(clientId, dateAdd(DAY_ONE, 1))!;
    expect(missDay.followupState).toBe('pending'); // P3-2
  });

  it('duplicate GM increments once', () => {
    play(['gm+gm']);
    expect(statuses(1)).toEqual([{ status: 'compliant', streak: 1 }]);
  });

  it('failure → pending_review, resolved by a later GM the same day', () => {
    play(['fail+gm']);
    expect(statuses(1)).toEqual([{ status: 'compliant', streak: 1 }]);
  });

  it('failure after a compliant day is a no-op', () => {
    engine.recordValidGm(clientId);
    const day = engine.recordClassificationFailure(clientId);
    expect(day.status).toBe('compliant');
  });
});

describe('replay: holds and downtime', () => {
  it('an unresolved pending day holds forever and is transparent to later streaks', () => {
    play(['gm', 'fail', 'gm']);
    expect(statuses(3)).toEqual([
      { status: 'compliant', streak: 1 },
      { status: 'pending_review', streak: undefined }, // held: NULL streak
      { status: 'compliant', streak: 2 },              // builds on day 1
    ]);
    expect(compliance.currentStreak(clientId)).toBe(2);
  });

  it('multi-day downtime closes retroactively with followups on next touch', () => {
    // days 2-4 fully silent; the GM on day 5 reconciles-on-touch first
    play(['gm', 'none', 'none', 'none', 'gm']);
    expect(statuses(5)).toEqual([
      { status: 'compliant', streak: 1 },
      { status: 'miss', streak: 0 },
      { status: 'miss', streak: 0 },
      { status: 'miss', streak: 0 },
      { status: 'compliant', streak: 1 },
    ]);
    expect(compliance.listFollowupsPending()).toHaveLength(3);
  });

  it('reconcile is idempotent — a second run closes nothing', () => {
    play(['gm', 'none', 'none']);
    const again = engine.reconcile(clientId);
    expect(again.closed).toEqual([]);
  });

  it('verification day itself is never closed as a miss', () => {
    // no GM ever; advance two days and reconcile
    ctx.clock.advance(2 * DAY_MS);
    engine.reconcile(clientId);
    // day one (verification day) absent; only the day after closed as miss
    expect(statuses(2)).toEqual([{ status: 'absent' }, { status: 'miss', streak: 0 }]);
  });
});

describe('replay: backward time (D20)', () => {
  it('refuses with an audit event and changes nothing', () => {
    play(['gm', 'gm']);
    const before = statuses(2);

    ctx.clock.advance(-3 * DAY_MS);
    const result = engine.reconcile(clientId);

    expect(result.closed).toEqual([]);
    expect(statuses(2)).toEqual(before);
    expect(audit.listEvents({ clientId }).map((e) => e.action)).toContain(
      'reconcile_backward_time_refused'
    );
  });
});

describe('corrections', () => {
  it('correcting a held pending day to compliant recomputes forward streaks', () => {
    play(['gm', 'fail', 'gm', 'gm']);
    // held day 2; streaks: 1, NULL, 2, 3
    engine.correctDay(clientId, dateAdd(DAY_ONE, 1), 'compliant', 'operator');
    expect(statuses(4)).toEqual([
      { status: 'compliant', streak: 1 },
      { status: 'compliant', streak: 2 },
      { status: 'compliant', streak: 3 },
      { status: 'compliant', streak: 4 },
    ]);
    expect(audit.listEvents({ clientId }).map((e) => e.action)).toContain('compliance_corrected');
  });

  it('correcting a compliant day to miss zeroes and rebuilds later streaks', () => {
    play(['gm', 'gm', 'gm']);
    engine.correctDay(clientId, dateAdd(DAY_ONE, 1), 'miss', 'operator');
    expect(statuses(3)).toEqual([
      { status: 'compliant', streak: 1 },
      { status: 'miss', streak: 0 },
      { status: 'compliant', streak: 1 },
    ]);
  });

  it('refuses future corrections', () => {
    expect(() => engine.correctDay(clientId, dateAdd(DAY_ONE, 5), 'miss', 'operator')).toThrow(
      /future/
    );
  });
});

describe('guards', () => {
  it('compliance events require an active client', () => {
    const c2 = clients.create({ displayName: 'Stranger', timezone: 'UTC' });
    expect(() => engine.recordValidGm(c2.id)).toThrow(/active/);
  });

  it('reconcileAll covers active clients only', () => {
    clients.create({ displayName: 'Unverified', timezone: 'UTC' });
    ctx.clock.advance(2 * DAY_MS);
    const r = engine.reconcileAll();
    expect(r.clients).toBe(1);
    expect(r.closed).toBe(1); // one silent full day for the active client
  });
});
