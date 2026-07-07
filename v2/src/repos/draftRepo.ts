import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from './auditRepo.js';
import { newId } from './ids.js';
import { withTransaction } from './tx.js';
import type { Draft, DraftStatus, ResponseType } from './types.js';

/** The DB's partial unique index refused a second active draft (P2-6). */
export class ActiveDraftExistsError extends Error {
  constructor(clientId: string) {
    super(`Client ${clientId} already has an active draft`);
    this.name = 'ActiveDraftExistsError';
  }
}

/**
 * Draft lifecycle + the freshness primitive (D19). The send flow that
 * composes isFresh with the channel adapter is Stage 5.
 */
export interface DraftRepo {
  create(input: {
    clientId: string;
    coversThroughMessageId: string;
    draftText: string;
    responseType: ResponseType;
    confidence?: number;
    autonomyLevel?: number;
  }): Draft;
  get(id: string): Draft | undefined;
  getActive(clientId: string): Draft | undefined;
  list(clientId: string, status?: DraftStatus): Draft[];
  isFresh(draft: Draft): boolean;
  markStale(id: string): void;
  markRejected(id: string): void;
  markSent(id: string, finalText: string): void;
}

export function createDraftRepo(db: Db, clock: Clock, audit: AuditRepo): DraftRepo {
  const get = (id: string): Draft | undefined => {
    const r = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r === undefined ? undefined : mapDraft(r);
  };

  const requireDraft = (id: string): Draft => {
    const d = get(id);
    if (d === undefined) throw new Error(`Draft not found: ${id}`);
    return d;
  };

  const transition = (id: string, from: DraftStatus[], to: DraftStatus): void => {
    const placeholders = from.map(() => '?').join(', ');
    const changed = db
      .prepare(`UPDATE drafts SET status = ?, resolved_at = ? WHERE id = ? AND status IN (${placeholders})`)
      .run(to, clock.now().toISOString(), id, ...from).changes;
    if (changed === 0) {
      const d = requireDraft(id);
      throw new Error(`Cannot move draft ${id} from '${d.status}' to '${to}'`);
    }
  };

  return {
    create(input) {
      try {
        const id = newId();
        db.prepare(
          `INSERT INTO drafts (id, client_id, covers_through_message_id, draft_text,
             response_type, confidence, autonomy_level, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          input.clientId,
          input.coversThroughMessageId,
          input.draftText,
          input.responseType,
          input.confidence ?? null,
          input.autonomyLevel ?? 0,
          clock.now().toISOString()
        );
        return requireDraft(id);
      } catch (err) {
        // The partial unique index surfaces as a column-list constraint message.
        if (err instanceof Error && err.message.includes('UNIQUE constraint failed: drafts.client_id')) {
          throw new ActiveDraftExistsError(input.clientId);
        }
        throw err;
      }
    },

    get,

    getActive(clientId) {
      const r = db
        .prepare("SELECT * FROM drafts WHERE client_id = ? AND status = 'draft'")
        .get(clientId) as Record<string, unknown> | undefined;
      return r === undefined ? undefined : mapDraft(r);
    },

    list(clientId, status) {
      const rows = (
        status === undefined
          ? db.prepare('SELECT * FROM drafts WHERE client_id = ? ORDER BY id DESC').all(clientId)
          : db
              .prepare('SELECT * FROM drafts WHERE client_id = ? AND status = ? ORDER BY id DESC')
              .all(clientId, status)
      ) as Array<Record<string, unknown>>;
      return rows.map(mapDraft);
    },

    // D19: fresh = no inbound message newer than what the draft covers.
    // Monotonic ULIDs make "newer" a simple id comparison (insertion order).
    isFresh(draft) {
      const r = db
        .prepare(
          `SELECT EXISTS (
             SELECT 1 FROM messages
             WHERE client_id = ? AND direction = 'inbound' AND id > ?
           ) AS newer`
        )
        .get(draft.clientId, draft.coversThroughMessageId) as { newer: number };
      return r.newer === 0;
    },

    markStale(id) {
      transition(id, ['draft', 'approved'], 'stale');
    },

    markRejected(id) {
      withTransaction(db, () => {
        const d = requireDraft(id);
        transition(id, ['draft', 'approved'], 'rejected');
        audit.event({ clientId: d.clientId, actor: 'operator', action: 'draft_rejected', details: { draftId: id } });
      });
    },

    markSent(id, finalText) {
      withTransaction(db, () => {
        const d = requireDraft(id);
        const changed = db
          .prepare(
            `UPDATE drafts SET status = 'sent', final_text = ?, resolved_at = ?
             WHERE id = ? AND status IN ('draft', 'approved')`
          )
          .run(finalText, clock.now().toISOString(), id).changes;
        if (changed === 0) throw new Error(`Cannot send draft ${id} in status '${d.status}'`);
        audit.event({
          clientId: d.clientId,
          actor: 'operator',
          action: 'draft_sent',
          details: { draftId: id, edited: finalText !== d.draftText },
        });
      });
    },
  };
}

function mapDraft(r: Record<string, unknown>): Draft {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    coversThroughMessageId: r.covers_through_message_id as string,
    draftText: r.draft_text as string,
    finalText: (r.final_text as string | null) ?? undefined,
    responseType: r.response_type as ResponseType,
    confidence: (r.confidence as number | null) ?? undefined,
    status: r.status as DraftStatus,
    autonomyLevel: r.autonomy_level as number,
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? undefined,
  };
}
