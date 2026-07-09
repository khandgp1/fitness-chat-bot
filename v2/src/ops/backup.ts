import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Clock } from '../clock/clock.js';

/**
 * Nightly backup (Stage 8): once per calendar day, a WAL-checkpointed copy of
 * the DB plus the narratives directory lands in data/backups/<YYYY-MM-DD>/.
 * Same second-connection checkpoint technique as the D20 snapshot — safe
 * while the app runs. Local files only (D3: near-free, no managed services).
 */
export const backupsDirFor = (dbPath: string): string => join(dirname(dbPath), 'backups');

export function backupNow(opts: {
  dbPath: string;
  narrativesDir: string;
  backupsDir: string;
  date: string; // YYYY-MM-DD
}): string {
  const target = join(opts.backupsDir, opts.date);
  mkdirSync(target, { recursive: true });

  // Fold the WAL into the main file, then copy.
  const db = new Database(opts.dbPath);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  cpSync(opts.dbPath, join(target, basename(opts.dbPath)));

  if (existsSync(opts.narrativesDir)) {
    cpSync(opts.narrativesDir, join(target, 'narratives'), { recursive: true });
  }
  return target;
}

export function pruneBackups(backupsDir: string, keep: number): number {
  if (!existsSync(backupsDir)) return 0;
  const dated = readdirSync(backupsDir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const excess = dated.slice(0, Math.max(0, dated.length - keep));
  for (const d of excess) rmSync(join(backupsDir, d), { recursive: true, force: true });
  return excess.length;
}

export function latestBackupDate(backupsDir: string): string | undefined {
  if (!existsSync(backupsDir)) return undefined;
  return readdirSync(backupsDir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .at(-1);
}

/** Idempotent per effective-clock day; returns the backup dir when one was taken. */
export function runDailyBackup(opts: {
  dbPath: string;
  narrativesDir: string;
  clock: Clock;
  keep?: number;
}): string | undefined {
  const backupsDir = backupsDirFor(opts.dbPath);
  const date = opts.clock.now().toISOString().slice(0, 10);
  if (existsSync(join(backupsDir, date))) return undefined; // today's exists
  const target = backupNow({ dbPath: opts.dbPath, narrativesDir: opts.narrativesDir, backupsDir, date });
  pruneBackups(backupsDir, opts.keep ?? 14);
  return target;
}
