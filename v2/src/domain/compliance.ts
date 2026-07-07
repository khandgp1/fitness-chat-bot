import { clientDate, DAY_MS, type Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from '../repos/auditRepo.js';
import type { ClientRepo } from '../repos/clientRepo.js';
import type { ComplianceRepo } from '../repos/complianceRepo.js';
import { withTransaction } from '../repos/tx.js';
import type { Client, ComplianceDay } from '../repos/types.js';

/**
 * The compliance state machine + reconciler (Phase 1 §2.5, Phase 2 §2.3).
 * SOLE WRITER: this engine is the only code allowed to call
 * ComplianceRepo.upsertDay. Everything else observes.
 *
 * State machine:
 *   unknown        → compliant       valid GM today (client tz)
 *   unknown        → pending_review  classification failure today
 *   unknown        → miss            day closes with neither (reconciler)
 *   pending_review → compliant       valid GM later the same day
 *   pending_review → (held)          day closes unresolved — holds indefinitely
 *   compliant      → compliant       duplicate GM: no-op
 *
 * Streaks: compliant = streak-before + 1; miss = 0; pending = NULL (hold).
 * Held days are transparent — streak-before skips them.
 */
export interface ComplianceEngine {
  recordValidGm(clientId: string, messageId?: string): ComplianceDay;
  recordClassificationFailure(clientId: string): ComplianceDay;
  reconcile(clientId: string): { closed: ComplianceDay[]; upTo: string };
  reconcileAll(): { clients: number; closed: number };
  correctDay(
    clientId: string,
    date: string,
    status: 'compliant' | 'miss',
    actor: 'operator'
  ): void;
}

/** YYYY-MM-DD arithmetic; dates are timezone-less calendar values here. */
export function dateAdd(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function createComplianceEngine(deps: {
  db: Db;
  clock: Clock;
  clients: ClientRepo;
  compliance: ComplianceRepo;
  audit: AuditRepo;
}): ComplianceEngine {
  const { db, clock, clients, compliance, audit } = deps;

  const todayFor = (c: Client): string => clientDate(c.timezone, clock.now());

  const requireActive = (clientId: string): Client => {
    const c = clients.get(clientId);
    if (c === undefined) throw new Error(`Client not found: ${clientId}`);
    if (c.status !== 'active') {
      throw new Error(`Compliance events require an active client (${clientId} is '${c.status}')`);
    }
    return c;
  };

  /**
   * Baseline = the last date considered settled. For a client never
   * reconciled, that's their verification date — so the first day that can
   * ever close as a miss is their first FULL day (verification-day grace).
   */
  const baselineFor = (c: Client): string =>
    c.lastReconciledDate ?? clientDate(c.timezone, new Date(c.verifiedAt ?? c.createdAt));

  /** Forward-only closure walk through yesterday. Today is never closed. */
  function reconcileClient(c: Client): { closed: ComplianceDay[]; upTo: string } {
    const yesterday = dateAdd(todayFor(c), -1);
    const baseline = baselineFor(c);

    if (yesterday < baseline) {
      // Backward time (D20): refuse loudly, change nothing.
      if (c.lastReconciledDate !== undefined && yesterday < c.lastReconciledDate) {
        console.warn(
          `[compliance] backward time refused for ${c.id}: yesterday=${yesterday} < last_reconciled=${c.lastReconciledDate}`
        );
        audit.event({
          clientId: c.id,
          actor: 'system',
          action: 'reconcile_backward_time_refused',
          details: { lastReconciledDate: c.lastReconciledDate, effectiveYesterday: yesterday },
        });
      }
      return { closed: [], upTo: c.lastReconciledDate ?? baseline };
    }

    const closed: ComplianceDay[] = [];
    for (let d = dateAdd(baseline, 1); d <= yesterday; d = dateAdd(d, 1)) {
      const day = compliance.getDay(c.id, d);
      if (day === undefined || day.status === 'unknown') {
        const miss: ComplianceDay = {
          clientId: c.id,
          date: d,
          status: 'miss',
          streakAfter: 0,
          resolvedAt: clock.now().toISOString(),
          followupState: 'pending', // P3-2: a miss becomes a triage item, never an auto-message
        };
        compliance.upsertDay(miss);
        closed.push(miss);
      }
      // pending_review: held (streak_after stays NULL); compliant: already resolved
    }
    clients.setLastReconciledDate(c.id, yesterday);
    return { closed, upTo: yesterday };
  }

  return {
    // Reconcile-on-touch: streak math always runs against a closed history.
    recordValidGm(clientId, messageId) {
      return withTransaction(db, () => {
        const c = requireActive(clientId);
        reconcileClient(c);
        const date = todayFor(c);
        const existing = compliance.getDay(clientId, date);
        if (existing?.status === 'compliant') return existing; // duplicate GM: no-op
        const day: ComplianceDay = {
          clientId,
          date,
          status: 'compliant',
          streakAfter: compliance.streakBefore(clientId, date) + 1,
          resolvedAt: clock.now().toISOString(),
          resolvingMessageId: messageId,
        };
        compliance.upsertDay(day);
        return day;
      });
    },

    recordClassificationFailure(clientId) {
      return withTransaction(db, () => {
        const c = requireActive(clientId);
        reconcileClient(c);
        const date = todayFor(c);
        const existing = compliance.getDay(clientId, date);
        // A confirmed day is settled; an already-pending day stays pending.
        if (existing?.status === 'compliant' || existing?.status === 'pending_review') {
          return existing;
        }
        const day: ComplianceDay = { clientId, date, status: 'pending_review' };
        compliance.upsertDay(day);
        return day;
      });
    },

    reconcile(clientId) {
      const c = clients.get(clientId);
      if (c === undefined) throw new Error(`Client not found: ${clientId}`);
      if (c.status !== 'active') return { closed: [], upTo: c.lastReconciledDate ?? '' };
      return withTransaction(db, () => reconcileClient(c));
    },

    reconcileAll() {
      let clientCount = 0;
      let closedCount = 0;
      for (const c of clients.listByStatus('active')) {
        closedCount += withTransaction(db, () => reconcileClient(c)).closed.length;
        clientCount += 1;
      }
      return { clients: clientCount, closed: closedCount };
    },

    // Operator authority over any past day — including held pending-reviews.
    // Recomputes streaks forward so a correction never leaves stale math.
    correctDay(clientId, date, status, actor) {
      withTransaction(db, () => {
        const c = clients.get(clientId);
        if (c === undefined) throw new Error(`Client not found: ${clientId}`);
        const today = todayFor(c);
        if (date > today) throw new Error(`Cannot correct a future day: ${date}`);

        const existing = compliance.getDay(clientId, date);
        let streak = status === 'compliant' ? compliance.streakBefore(clientId, date) + 1 : 0;
        compliance.upsertDay({
          clientId,
          date,
          status,
          streakAfter: streak,
          resolvedAt: clock.now().toISOString(),
          followupState: existing?.followupState, // corrections don't spawn new followups
        });

        for (const later of compliance.listDays(clientId, dateAdd(date, 1), today)) {
          if (later.streakAfter === undefined) continue; // held days stay transparent
          streak = later.status === 'compliant' ? streak + 1 : 0;
          if (later.streakAfter !== streak) {
            compliance.upsertDay({ ...later, streakAfter: streak });
          }
        }

        audit.event({
          clientId,
          actor,
          action: 'compliance_corrected',
          details: { date, status, previous: existing?.status ?? 'none' },
        });
      });
    },
  };
}
