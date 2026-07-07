import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock } from '../../src/clock/clock.js';
import { openDb, type Db } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';

export interface TestCtx {
  db: Db;
  dir: string;
  clock: Clock;
  cleanup(): void;
}

/** Temp-file DB at schema HEAD + a manually advanceable fixed clock. */
export function makeTestDb(): TestCtx {
  const dir = mkdtempSync(join(tmpdir(), 'v2-test-'));
  const db = openDb(join(dir, 'test.sqlite'));
  runMigrations(db, fileURLToPath(new URL('../../migrations', import.meta.url)));

  let nowMs = Date.parse('2026-07-07T12:00:00.000Z');
  const clock: Clock = {
    now: () => new Date(nowMs),
    offsetMs: () => 0,
    advance: (ms) => {
      nowMs += ms;
    },
    reset: () => {
      nowMs = Date.parse('2026-07-07T12:00:00.000Z');
    },
  };

  return {
    db,
    dir,
    clock,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
