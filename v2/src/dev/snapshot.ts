import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';

/**
 * D20: dev clock rewind = snapshot/restore, never reverse state-machine
 * logic. File-level copies of the DB (WAL-checkpointed first) and the clock
 * sidecar, taken together so state and time stay consistent by construction.
 *
 * Callers must not hold the DB open across takeSnapshot/restoreSnapshot.
 */
const snapDir = (dbPath: string): string => `${dbPath}.snapshot`;
const clockFile = (dbPath: string): string => `${dbPath}.clock.json`;

export function snapshotExists(dbPath: string): boolean {
  return existsSync(join(snapDir(dbPath), basename(dbPath)));
}

export function takeSnapshot(dbPath: string): void {
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
  // Fold the WAL into the main file so one file is the whole state.
  const db = new Database(dbPath);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  mkdirSync(snapDir(dbPath), { recursive: true });
  copyFileSync(dbPath, join(snapDir(dbPath), basename(dbPath)));
  if (existsSync(clockFile(dbPath))) {
    copyFileSync(clockFile(dbPath), join(snapDir(dbPath), basename(clockFile(dbPath))));
  }
}

export function restoreSnapshot(dbPath: string): void {
  if (!snapshotExists(dbPath)) throw new Error(`No snapshot to restore for ${dbPath}`);

  copyFileSync(join(snapDir(dbPath), basename(dbPath)), dbPath);
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const snapClock = join(snapDir(dbPath), basename(clockFile(dbPath)));
  if (existsSync(snapClock)) {
    copyFileSync(snapClock, clockFile(dbPath));
  } else {
    rmSync(clockFile(dbPath), { force: true }); // no sidecar at snapshot time → none now
  }

  rmSync(snapDir(dbPath), { recursive: true, force: true });
}
