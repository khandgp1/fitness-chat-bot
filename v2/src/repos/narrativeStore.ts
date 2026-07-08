import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from './auditRepo.js';
import { newId } from './ids.js';
import type { NarrativeFlag } from './types.js';

/**
 * Spans both media (D16 as revised 2026-07-08): narrative content is a
 * markdown file per client under v2/data/narratives (gitignored client data,
 * NO git history — narratives are derivative of the SQLite conversation
 * history); watermark and flags live in SQLite. Versioning is a daily
 * pre-image snapshot (Option A): the first write of a (dev-clock) day copies
 * the previous content to history/<clientId>/<YYYY-MM-DD>.md; later writes
 * that day skip. Audit events are the queryable change trail.
 */
export interface NarrativeStore {
  read(clientId: string): { content: string | undefined; path: string };
  quickEdit(clientId: string, content: string, actor: 'operator'): void;
  snapshotDaily(clientId: string): boolean; // pre-image guard for direct file edits; true if taken
  getWatermark(clientId: string): string | undefined;
  setWatermark(clientId: string, ts: string): void;
  addFlag(clientId: string, note: string, createdBy: 'agent' | 'operator'): void;
  listUnclearedFlags(clientId: string): NarrativeFlag[];
  stalenessScore(clientId: string): { flags: number; replyWorthyBatches: number };
}

export function createNarrativeStore(
  db: Db,
  clock: Clock,
  audit: AuditRepo,
  opts: { narrativesDir: string }
): NarrativeStore {
  const dir = opts.narrativesDir;
  const fileFor = (clientId: string) => join(dir, `${clientId}.md`);

  // Option A: at most one pre-image per client per effective-clock day.
  const snapshotDaily = (clientId: string): boolean => {
    const path = fileFor(clientId);
    if (!existsSync(path)) return false; // nothing to preserve
    const date = clock.now().toISOString().slice(0, 10);
    const histDir = join(dir, 'history', clientId);
    const snapPath = join(histDir, `${date}.md`);
    if (existsSync(snapPath)) return false; // today's pre-image already taken
    mkdirSync(histDir, { recursive: true });
    copyFileSync(path, snapPath);
    return true;
  };

  return {
    read(clientId) {
      const path = fileFor(clientId);
      return { content: existsSync(path) ? readFileSync(path, 'utf8') : undefined, path };
    },

    quickEdit(clientId, content, actor) {
      mkdirSync(dir, { recursive: true });
      snapshotDaily(clientId);
      writeFileSync(fileFor(clientId), content);
      audit.event({ clientId, actor, action: 'narrative_quick_edit' });
    },

    snapshotDaily,

    getWatermark(clientId) {
      const r = db
        .prepare('SELECT watermark_ts FROM narrative_meta WHERE client_id = ?')
        .get(clientId) as { watermark_ts: string | null } | undefined;
      return r?.watermark_ts ?? undefined;
    },

    setWatermark(clientId, ts) {
      db.prepare(
        `INSERT INTO narrative_meta (client_id, watermark_ts) VALUES (?, ?)
         ON CONFLICT (client_id) DO UPDATE SET watermark_ts = excluded.watermark_ts`
      ).run(clientId, ts);
      // Flags covered by the new watermark are adjudicated (D18).
      db.prepare(
        `UPDATE narrative_flags SET cleared_at = ?
         WHERE client_id = ? AND cleared_at IS NULL AND created_at <= ?`
      ).run(clock.now().toISOString(), clientId, ts);
    },

    addFlag(clientId, note, createdBy) {
      db.prepare(
        `INSERT INTO narrative_flags (id, client_id, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(newId(), clientId, note, createdBy, clock.now().toISOString());
    },

    listUnclearedFlags(clientId) {
      const rows = db
        .prepare(
          'SELECT * FROM narrative_flags WHERE client_id = ? AND cleared_at IS NULL ORDER BY id'
        )
        .all(clientId) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        clientId: r.client_id as string,
        note: r.note as string,
        createdBy: r.created_by as NarrativeFlag['createdBy'],
        createdAt: r.created_at as string,
        clearedAt: (r.cleared_at as string | null) ?? undefined,
      }));
    },

    // Phase 1 §2.9: computed, never stored.
    stalenessScore(clientId) {
      const flags = (
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM narrative_flags WHERE client_id = ? AND cleared_at IS NULL'
          )
          .get(clientId) as { n: number }
      ).n;
      const watermark = this.getWatermark(clientId) ?? '';
      const replyWorthyBatches = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM batches
             WHERE client_id = ? AND needs_response = 1 AND created_at > ?`
          )
          .get(clientId, watermark) as { n: number }
      ).n;
      return { flags, replyWorthyBatches };
    },
  };
}
