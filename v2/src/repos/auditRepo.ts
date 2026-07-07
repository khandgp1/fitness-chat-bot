import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import { newId } from './ids.js';
import type { AuditEvent, LlmCall, LlmCallInput } from './types.js';

/**
 * Append-only. There is deliberately no delete surface: audit history
 * survives client reset and deletion (Phase 2 §2.6).
 */
export interface AuditRepo {
  event(e: { clientId?: string; actor: 'operator' | 'system'; action: string; details?: unknown }): void;
  llmCall(c: LlmCallInput): void;
  listEvents(opts?: { clientId?: string; limit?: number }): AuditEvent[];
  listLlmCalls(opts?: { clientId?: string; limit?: number }): LlmCall[];
}

export function createAuditRepo(db: Db, clock: Clock): AuditRepo {
  return {
    event(e) {
      db.prepare(
        'INSERT INTO audit_events (id, client_id, actor, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        newId(),
        e.clientId ?? null,
        e.actor,
        e.action,
        e.details === undefined ? null : JSON.stringify(e.details),
        clock.now().toISOString()
      );
    },

    llmCall(c) {
      db.prepare(
        `INSERT INTO llm_calls (id, client_id, batch_id, agent, model, prompt_file_hash,
           input_tokens, output_tokens, latency_ms, result, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(),
        c.clientId ?? null,
        c.batchId ?? null,
        c.agent,
        c.model,
        c.promptFileHash ?? null,
        c.inputTokens ?? null,
        c.outputTokens ?? null,
        c.latencyMs ?? null,
        c.result === undefined ? null : JSON.stringify(c.result),
        c.error ?? null,
        clock.now().toISOString()
      );
    },

    listEvents(opts = {}) {
      const rows = queryScoped(db, 'audit_events', opts) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        clientId: (r.client_id as string | null) ?? undefined,
        actor: r.actor as AuditEvent['actor'],
        action: r.action as string,
        details: r.details === null ? undefined : JSON.parse(r.details as string),
        createdAt: r.created_at as string,
      }));
    },

    listLlmCalls(opts = {}) {
      const rows = queryScoped(db, 'llm_calls', opts) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        clientId: (r.client_id as string | null) ?? undefined,
        batchId: (r.batch_id as string | null) ?? undefined,
        agent: r.agent as LlmCall['agent'],
        model: r.model as string,
        promptFileHash: (r.prompt_file_hash as string | null) ?? undefined,
        inputTokens: (r.input_tokens as number | null) ?? undefined,
        outputTokens: (r.output_tokens as number | null) ?? undefined,
        latencyMs: (r.latency_ms as number | null) ?? undefined,
        result: r.result === null ? undefined : JSON.parse(r.result as string),
        error: (r.error as string | null) ?? undefined,
        createdAt: r.created_at as string,
      }));
    },
  };
}

function queryScoped(
  db: Db,
  table: 'audit_events' | 'llm_calls',
  opts: { clientId?: string; limit?: number }
): unknown[] {
  const limit = opts.limit ?? 50;
  if (opts.clientId !== undefined) {
    return db
      .prepare(`SELECT * FROM ${table} WHERE client_id = ? ORDER BY id DESC LIMIT ?`)
      .all(opts.clientId, limit);
  }
  return db.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ?`).all(limit);
}
