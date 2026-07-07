import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './connection.js';

/**
 * Forward-only migration runner (P2-7). Bootstraps schema_migrations itself,
 * then applies numbered migrations/NNN_*.sql files above the current version,
 * each inside a transaction. There are no down-migrations — rollback is a DB
 * snapshot (D20 tooling).
 */
export function runMigrations(db: Db, dir: string): { applied: number[]; version: number } {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  );

  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .map((f) => ({ file: f, version: Number.parseInt(f, 10) }))
    .sort((a, b) => a.version - b.version);

  const seen = new Set<number>();
  for (const { file, version } of files) {
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version} (${file})`);
    seen.add(version);
  }

  const currentRow = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
    v: number | null;
  };
  const current = currentRow.v ?? 0;

  const applied: number[] = [];
  for (const { file, version } of files) {
    if (version <= current) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString()
      );
    })();
    applied.push(version);
  }

  return { applied, version: Math.max(current, ...applied, 0) };
}
