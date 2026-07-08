import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { MessageRepo } from '../repos/messageRepo.js';

/**
 * Debounce (D4): wait for a client's burst to go quiet, then close their
 * open batch. In-memory timers are only a latency optimization — the DB is
 * the truth, and sweep() recovers anything a crash orphaned (P2-5).
 */
export interface Debouncer {
  touch(clientId: string): void; // (re)start the client's window
  sweep(): number; // close overdue open batches; returns count
  rearm(): number; // re-schedule timers for open-but-not-overdue batches (boot); returns count
  stop(): void; // clear timers (shutdown/tests)
}

export function createDebouncer(
  deps: { db: Db; clock: Clock; messages: MessageRepo },
  opts: { debounceMs: number; onBatchClosed: (batchId: string, clientId: string) => void }
): Debouncer {
  const timers = new Map<string, NodeJS.Timeout>();

  const closeOpenBatches = (clientId: string): void => {
    timers.delete(clientId);
    for (const b of deps.messages.listBatches(clientId, 'open')) {
      deps.messages.closeBatch(b.id);
      opts.onBatchClosed(b.id, clientId);
    }
  };

  return {
    touch(clientId) {
      const existing = timers.get(clientId);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        clientId,
        setTimeout(() => closeOpenBatches(clientId), opts.debounceMs)
      );
    },

    // Overdue = an open batch whose newest activity (last message, or the
    // batch itself if empty) is older than the window. Fresh batches with
    // live timers are naturally not overdue.
    sweep() {
      const cutoff = new Date(deps.clock.now().getTime() - opts.debounceMs).toISOString();
      const rows = deps.db
        .prepare(
          `SELECT b.id, b.client_id AS clientId, COALESCE(MAX(m.created_at), b.created_at) AS last
           FROM batches b LEFT JOIN messages m ON m.batch_id = b.id
           WHERE b.status = 'open'
           GROUP BY b.id
           HAVING last < ?`
        )
        .all(cutoff) as Array<{ id: string; clientId: string }>;
      for (const row of rows) {
        deps.messages.closeBatch(row.id);
        opts.onBatchClosed(row.id, row.clientId);
      }
      return rows.length;
    },

    // Timers die with the process. After a restart, open batches whose window
    // has NOT yet elapsed get a fresh timer for the REMAINING time — without
    // this they'd wait for the next periodic sweep (up to the tick interval).
    rearm() {
      const now = deps.clock.now().getTime();
      const rows = deps.db
        .prepare(
          `SELECT b.client_id AS clientId, COALESCE(MAX(m.created_at), b.created_at) AS last
           FROM batches b LEFT JOIN messages m ON m.batch_id = b.id
           WHERE b.status = 'open'
           GROUP BY b.client_id`
        )
        .all() as Array<{ clientId: string; last: string }>;
      let count = 0;
      for (const row of rows) {
        if (timers.has(row.clientId)) continue; // live timer wins
        const remaining = new Date(row.last).getTime() + opts.debounceMs - now;
        if (remaining <= 0) continue; // overdue — sweep()'s job
        timers.set(
          row.clientId,
          setTimeout(() => closeOpenBatches(row.clientId), remaining)
        );
        count += 1;
      }
      return count;
    },

    stop() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
