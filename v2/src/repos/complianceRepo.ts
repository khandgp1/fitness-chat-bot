import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from './auditRepo.js';
import { newId } from './ids.js';
import { withTransaction } from './tx.js';
import type { ComplianceDay, ComplianceStatus, FollowupState } from './types.js';

export interface Classification {
  id: string;
  clientId: string;
  batchId: string;
  isValidGm?: boolean; // undefined = classification failed → pending_review
  reasoning?: string;
  model: string;
  createdAt: string;
}

/**
 * SHELL (Stage 1): reads, the upsert primitive, and the streak derivation.
 * The state machine that decides transitions arrives in Stage 2 and is the
 * only code allowed to call upsertDay (Phase 2 §5: sole-writer discipline).
 */
export interface ComplianceRepo {
  getDay(clientId: string, date: string): ComplianceDay | undefined;
  listDays(clientId: string, fromDate: string, toDate: string): ComplianceDay[];
  currentStreak(clientId: string): number;
  streakBefore(clientId: string, date: string): number;
  upsertDay(day: ComplianceDay): void;
  setFollowupState(clientId: string, date: string, state: FollowupState): void;
  listFollowupsPending(): ComplianceDay[];
  recordClassification(input: {
    clientId: string;
    batchId: string;
    isValidGm?: boolean;
    reasoning?: string;
    model: string;
  }): void;
  listClassifications(batchId: string): Classification[];
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

    // Streak as of just before `date`, skipping NULL (held) days — the input
    // to "compliant day = streak-before + 1".
    streakBefore(clientId, date) {
      const r = db
        .prepare(
          `SELECT streak_after AS s FROM compliance_days
           WHERE client_id = ? AND date < ? AND streak_after IS NOT NULL
           ORDER BY date DESC LIMIT 1`
        )
        .get(clientId, date) as { s: number } | undefined;
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

    // Full classifier audit trail (Phase 2 §2.3). NULL is_valid_gm = failure.
    recordClassification(input) {
      db.prepare(
        `INSERT INTO classifications (id, client_id, batch_id, is_valid_gm, reasoning, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(),
        input.clientId,
        input.batchId,
        input.isValidGm === undefined ? null : input.isValidGm ? 1 : 0,
        input.reasoning ?? null,
        input.model,
        clock.now().toISOString()
      );
    },

    listClassifications(batchId) {
      const rows = db
        .prepare('SELECT * FROM classifications WHERE batch_id = ? ORDER BY id')
        .all(batchId) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        clientId: r.client_id as string,
        batchId: r.batch_id as string,
        isValidGm: r.is_valid_gm === null ? undefined : (r.is_valid_gm as number) === 1,
        reasoning: (r.reasoning as string | null) ?? undefined,
        model: r.model as string,
        createdAt: r.created_at as string,
      }));
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
