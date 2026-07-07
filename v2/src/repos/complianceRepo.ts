import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from './auditRepo.js';
import { withTransaction } from './tx.js';
import type { ComplianceDay, ComplianceStatus, FollowupState } from './types.js';

/**
 * SHELL (Stage 1): reads, the upsert primitive, and the streak derivation.
 * The state machine that decides transitions arrives in Stage 2 and is the
 * only code allowed to call upsertDay (Phase 2 §5: sole-writer discipline).
 */
export interface ComplianceRepo {
  getDay(clientId: string, date: string): ComplianceDay | undefined;
  listDays(clientId: string, fromDate: string, toDate: string): ComplianceDay[];
  currentStreak(clientId: string): number;
  upsertDay(day: ComplianceDay): void;
  setFollowupState(clientId: string, date: string, state: FollowupState): void;
  listFollowupsPending(): ComplianceDay[];
}

export function createComplianceRepo(db: Db, clock: Clock, audit: AuditRepo): ComplianceRepo {
  return {
    getDay(clientId, date) {
      const r = db
        .prepare('SELECT * FROM compliance_days WHERE client_id = ? AND date = ?')
        .get(clientId, date) as Record<string, unknown> | undefined;
      return r === undefined ? undefined : mapDay(r);
    },

    listDays(clientId, fromDate, toDate) {
      const rows = db
        .prepare(
          'SELECT * FROM compliance_days WHERE client_id = ? AND date >= ? AND date <= ? ORDER BY date'
        )
        .all(clientId, fromDate, toDate) as Array<Record<string, unknown>>;
      return rows.map(mapDay);
    },

    // P2-4: the streak is streak_after of the most recent resolved day.
    // Pending-review days have NULL streak_after — the "hold" falls out of the query.
    currentStreak(clientId) {
      const r = db
        .prepare(
          `SELECT streak_after AS s FROM compliance_days
           WHERE client_id = ? AND streak_after IS NOT NULL
           ORDER BY date DESC LIMIT 1`
        )
        .get(clientId) as { s: number } | undefined;
      return r?.s ?? 0;
    },

    upsertDay(day) {
      db.prepare(
        `INSERT INTO compliance_days
           (client_id, date, status, streak_after, resolved_at, resolving_message_id, followup_state)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (client_id, date) DO UPDATE SET
           status = excluded.status,
           streak_after = excluded.streak_after,
           resolved_at = excluded.resolved_at,
           resolving_message_id = excluded.resolving_message_id,
           followup_state = excluded.followup_state`
      ).run(
        day.clientId,
        day.date,
        day.status,
        day.streakAfter ?? null,
        day.resolvedAt ?? null,
        day.resolvingMessageId ?? null,
        day.followupState ?? null
      );
    },

    setFollowupState(clientId, date, state) {
      withTransaction(db, () => {
        const changed = db
          .prepare('UPDATE compliance_days SET followup_state = ? WHERE client_id = ? AND date = ?')
          .run(state, clientId, date).changes;
        if (changed === 0) throw new Error(`No compliance day for ${clientId} ${date}`);
        audit.event({
          clientId,
          actor: state === 'handled' ? 'system' : 'operator',
          action: 'miss_followup_' + state,
          details: { date },
        });
      });
    },

    listFollowupsPending() {
      const rows = db
        .prepare("SELECT * FROM compliance_days WHERE followup_state = 'pending' ORDER BY date")
        .all() as Array<Record<string, unknown>>;
      return rows.map(mapDay);
    },
  };
}

function mapDay(r: Record<string, unknown>): ComplianceDay {
  return {
    clientId: r.client_id as string,
    date: r.date as string,
    status: r.status as ComplianceStatus,
    streakAfter: (r.streak_after as number | null) ?? undefined,
    resolvedAt: (r.resolved_at as string | null) ?? undefined,
    resolvingMessageId: (r.resolving_message_id as string | null) ?? undefined,
    followupState: (r.followup_state as FollowupState | null) ?? undefined,
  };
}
