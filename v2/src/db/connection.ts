import Database from 'better-sqlite3';

export type Db = Database.Database;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Design-plane read surface (Phase 1 §2.9): writes are impossible by
 * construction — SQLite itself refuses them on this connection.
 */
export function openDbReadOnly(path: string): Db {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}
