import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from './auditRepo.js';
import { newId } from './ids.js';
import type { NarrativeFlag } from './types.js';

/**
 * Spans both media (D16): narrative content is a markdown file per client in
 * a private directory with its own git history; watermark and flags live in
 * SQLite. Stage 7 formalizes the directory's setup; this store makes writes
 * safe (and committed) regardless of order by initializing git on first write.
 */
export interface NarrativeStore {
  read(clientId: string): { content: string | undefined; path: string };
  quickEdit(clientId: string, content: string, actor: 'operator'): void;
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

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

  const ensureRepo = (): void => {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, '.git'))) git('init', '--quiet');
  };

  return {
    read(clientId) {
      const path = fileFor(clientId);
      return { content: existsSync(path) ? readFileSync(path, 'utf8') : undefined, path };
    },

    quickEdit(clientId, content, actor) {
      ensureRepo();
      const path = fileFor(clientId);
      writeFileSync(path, content);
      git('add', `${clientId}.md`);
      const staged = git('diff', '--cached', '--name-only');
      if (staged !== '') {
        git(
          '-c', 'user.name=Coaching Bot',
          '-c', 'user.email=bot@localhost',
          'commit', '--quiet', '-m', `narrative(${clientId}): quick edit by ${actor}`
        );
      }
      audit.event({ clientId, actor, action: 'narrative_quick_edit' });
    },

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
