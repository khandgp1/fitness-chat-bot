import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { restoreSnapshot, snapshotExists, takeSnapshot } from '../src/dev/snapshot.js';

let dir: string;
let dbPath: string;

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
  dbPath = join(dir, 'demo.sqlite');
  const db = openDb(dbPath);
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare(
    "INSERT INTO clients (id, display_name, timezone, status, created_at) VALUES ('c1', 'Original', 'UTC', 'active', '2026-07-07T12:00:00Z')"
  ).run();
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('snapshot/restore (D20)', () => {
  it('restores DB rows and clock sidecar to the snapshot moment', () => {
    writeFileSync(`${dbPath}.clock.json`, JSON.stringify({ offsetMs: 0 }));
    expect(snapshotExists(dbPath)).toBe(false);
    takeSnapshot(dbPath);
    expect(snapshotExists(dbPath)).toBe(true);

    // "simulate": mutate state and leap the clock
    const db = openDb(dbPath);
    db.prepare("UPDATE clients SET display_name = 'Mutated' WHERE id = 'c1'").run();
    db.prepare(
      "INSERT INTO clients (id, display_name, timezone, status, created_at) VALUES ('c2', 'SimGhost', 'UTC', 'active', '2026-07-08T12:00:00Z')"
    ).run();
    db.close();
    writeFileSync(`${dbPath}.clock.json`, JSON.stringify({ offsetMs: 86400000 }));

    restoreSnapshot(dbPath);

    const restored = openDb(dbPath);
    const c1 = restored.prepare("SELECT display_name AS n FROM clients WHERE id = 'c1'").get() as { n: string };
    const count = restored.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number };
    restored.close();
    expect(c1.n).toBe('Original');
    expect(count.n).toBe(1); // the simulated client never happened
    expect(JSON.parse(readFileSync(`${dbPath}.clock.json`, 'utf8'))).toEqual({ offsetMs: 0 });
    expect(snapshotExists(dbPath)).toBe(false); // snapshot consumed
  });

  it('a snapshot taken with no clock sidecar restores to no sidecar', () => {
    takeSnapshot(dbPath);
    writeFileSync(`${dbPath}.clock.json`, JSON.stringify({ offsetMs: 999 }));
    restoreSnapshot(dbPath);
    expect(existsSync(`${dbPath}.clock.json`)).toBe(false);
  });

  it('refuses to snapshot a missing DB or restore a missing snapshot', () => {
    expect(() => takeSnapshot(join(dir, 'nope.sqlite'))).toThrow(/No database/);
    expect(() => restoreSnapshot(dbPath)).toThrow(/No snapshot/);
  });
});
