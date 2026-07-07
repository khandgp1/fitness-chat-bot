import type { Db } from '../db/connection.js';

export function withTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
