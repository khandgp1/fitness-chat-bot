import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from './auditRepo.js';
import { newId } from './ids.js';
import { withTransaction } from './tx.js';
import type { Batch, BatchStatus, Intent, Message } from './types.js';

/**
 * Messages + batch primitives. The debounce policy that decides WHEN to
 * open/close/process batches is Stage 3 pipeline code, not this repo.
 */
export interface MessageRepo {
  appendInbound(input: {
    clientId: string;
    text: string;
    channelMessageRef?: string;
    rawPayload?: string;
  }): Message;
  appendOutbound(input: { clientId: string; text: string; draftId?: string }): Message;
  list(clientId: string, opts?: { beforeId?: string; limit?: number }): Message[]; // newest-first
  latestInbound(clientId: string): Message | undefined;
  openBatch(clientId: string): Batch; // creates or returns the open batch
  assignToBatch(messageId: string, batchId: string): void;
  closeBatch(batchId: string): void; // open → pending
  markBatchProcessed(
    batchId: string,
    r: { primaryIntent: Intent; routerConfidence: number; needsResponse: boolean }
  ): void;
  dismissBatch(batchId: string): void;
  getBatch(batchId: string): Batch | undefined;
  listBatches(clientId: string, status?: BatchStatus): Batch[];
}

export function createMessageRepo(db: Db, clock: Clock, audit: AuditRepo): MessageRepo {
  const getBatch = (batchId: string): Batch | undefined => {
    const r = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as
      | Record<string, unknown>
      | undefined;
    return r === undefined ? undefined : mapBatch(r);
  };

  return {
    appendInbound(input) {
      const id = newId();
      db.prepare(
        `INSERT INTO messages (id, client_id, direction, text, channel_message_ref, raw_payload, created_at)
         VALUES (?, ?, 'inbound', ?, ?, ?, ?)`
      ).run(
        id,
        input.clientId,
        input.text,
        input.channelMessageRef ?? null,
        input.rawPayload ?? null,
        clock.now().toISOString()
      );
      return getMessage(db, id);
    },

    appendOutbound(input) {
      const id = newId();
      db.prepare(
        `INSERT INTO messages (id, client_id, direction, text, draft_id, created_at)
         VALUES (?, ?, 'outbound', ?, ?, ?)`
      ).run(id, input.clientId, input.text, input.draftId ?? null, clock.now().toISOString());
      return getMessage(db, id);
    },

    list(clientId, opts = {}) {
      const limit = opts.limit ?? 50;
      const rows = (
        opts.beforeId === undefined
          ? db
              .prepare('SELECT * FROM messages WHERE client_id = ? ORDER BY id DESC LIMIT ?')
              .all(clientId, limit)
          : db
              .prepare(
                'SELECT * FROM messages WHERE client_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
              )
              .all(clientId, opts.beforeId, limit)
      ) as Array<Record<string, unknown>>;
      return rows.map(mapMessage);
    },

    latestInbound(clientId) {
      const r = db
        .prepare(
          "SELECT * FROM messages WHERE client_id = ? AND direction = 'inbound' ORDER BY id DESC LIMIT 1"
        )
        .get(clientId) as Record<string, unknown> | undefined;
      return r === undefined ? undefined : mapMessage(r);
    },

    openBatch(clientId) {
      return withTransaction(db, () => {
        const existing = db
          .prepare("SELECT * FROM batches WHERE client_id = ? AND status = 'open'")
          .get(clientId) as Record<string, unknown> | undefined;
        if (existing !== undefined) return mapBatch(existing);
        const id = newId();
        db.prepare(
          "INSERT INTO batches (id, client_id, status, created_at) VALUES (?, ?, 'open', ?)"
        ).run(id, clientId, clock.now().toISOString());
        const created = getBatch(id);
        if (created === undefined) throw new Error('unreachable');
        return created;
      });
    },

    assignToBatch(messageId, batchId) {
      const changed = db
        .prepare('UPDATE messages SET batch_id = ? WHERE id = ?')
        .run(batchId, messageId).changes;
      if (changed === 0) throw new Error(`Message not found: ${messageId}`);
    },

    closeBatch(batchId) {
      const changed = db
        .prepare("UPDATE batches SET status = 'pending' WHERE id = ? AND status = 'open'")
        .run(batchId).changes;
      if (changed === 0) throw new Error(`Batch ${batchId} is not open`);
    },

    markBatchProcessed(batchId, r) {
      const changed = db
        .prepare(
          `UPDATE batches SET status = 'processed', primary_intent = ?, router_confidence = ?,
             needs_response = ?, processed_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(
          r.primaryIntent,
          r.routerConfidence,
          r.needsResponse ? 1 : 0,
          clock.now().toISOString(),
          batchId
        ).changes;
      if (changed === 0) throw new Error(`Batch ${batchId} is not pending`);
    },

    dismissBatch(batchId) {
      withTransaction(db, () => {
        const batch = getBatch(batchId);
        if (batch === undefined) throw new Error(`Batch not found: ${batchId}`);
        db.prepare('UPDATE batches SET dismissed_at = ? WHERE id = ?').run(
          clock.now().toISOString(),
          batchId
        );
        audit.event({
          clientId: batch.clientId,
          actor: 'operator',
          action: 'batch_dismissed',
          details: { batchId },
        });
      });
    },

    getBatch,

    listBatches(clientId, status) {
      const rows = (
        status === undefined
          ? db.prepare('SELECT * FROM batches WHERE client_id = ? ORDER BY id DESC').all(clientId)
          : db
              .prepare('SELECT * FROM batches WHERE client_id = ? AND status = ? ORDER BY id DESC')
              .all(clientId, status)
      ) as Array<Record<string, unknown>>;
      return rows.map(mapBatch);
    },
  };
}

function getMessage(db: Db, id: string): Message {
  const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown>;
  return mapMessage(r);
}

function mapMessage(r: Record<string, unknown>): Message {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    direction: r.direction as Message['direction'],
    text: r.text as string,
    channelMessageRef: (r.channel_message_ref as string | null) ?? undefined,
    rawPayload: (r.raw_payload as string | null) ?? undefined,
    batchId: (r.batch_id as string | null) ?? undefined,
    draftId: (r.draft_id as string | null) ?? undefined,
    createdAt: r.created_at as string,
  };
}

function mapBatch(r: Record<string, unknown>): Batch {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    status: r.status as BatchStatus,
    primaryIntent: (r.primary_intent as Intent | null) ?? undefined,
    routerConfidence: (r.router_confidence as number | null) ?? undefined,
    needsResponse: (r.needs_response as number) === 1,
    dismissedAt: (r.dismissed_at as string | null) ?? undefined,
    createdAt: r.created_at as string,
    processedAt: (r.processed_at as string | null) ?? undefined,
  };
}
