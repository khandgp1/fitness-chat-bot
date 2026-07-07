import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

const EXPECTED_TABLES = [
  'clients',
  'channel_identities',
  'batches',
  'messages',
  'compliance_days',
  'classifications',
  'drafts',
  'narrative_meta',
  'narrative_flags',
  'llm_calls',
  'audit_events',
];

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrate-test-'));
  db = openDb(join(dir, 'test.sqlite'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function tableNames(d: Db): string[] {
  return (
    d
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

describe('openDb pragmas', () => {
  it('applies WAL, foreign_keys, busy_timeout', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });
});

describe('runMigrations', () => {
  it('brings a fresh DB to version 1 with all 11 tables and key indexes', () => {
    const res = runMigrations(db, MIGRATIONS_DIR);
    expect(res.applied).toEqual([1]);
    expect(res.version).toBe(1);
    for (const t of EXPECTED_TABLES) {
      expect(tableNames(db), `missing table ${t}`).toContain(t);
    }
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(indexes).toContain('idx_drafts_one_active');
    expect(indexes).toContain('idx_messages_client_time');
  });

  it('is idempotent — a second run applies nothing', () => {
    runMigrations(db, MIGRATIONS_DIR);
    const second = runMigrations(db, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]);
    expect(second.version).toBe(1);
  });

  it('rolls back a failing migration cleanly', () => {
    const badDir = join(dir, 'migrations');
    mkdirSync(badDir);
    writeFileSync(join(badDir, '001_good.sql'), 'CREATE TABLE ok (id TEXT PRIMARY KEY);');
    writeFileSync(
      join(badDir, '002_bad.sql'),
      'CREATE TABLE half (id TEXT PRIMARY KEY); CREATE TABLE nope (bad syntax here!!;'
    );
    expect(() => runMigrations(db, badDir)).toThrow();
    // version stayed at 1; the half-applied table from 002 does not exist
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number | null;
    };
    expect(row.v).toBe(1);
    expect(tableNames(db)).toContain('ok');
    expect(tableNames(db)).not.toContain('half');
  });
});

describe('schema constraints', () => {
  beforeEach(() => {
    runMigrations(db, MIGRATIONS_DIR);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO clients (id, display_name, timezone, status, created_at) VALUES ('c1', 'Test', 'America/New_York', 'active', ?)"
    ).run(now);
    db.prepare(
      "INSERT INTO messages (id, client_id, direction, text, created_at) VALUES ('m1', 'c1', 'inbound', 'GM', ?)"
    ).run(now);
  });

  it('the database itself rejects a second active draft per client (P2-6)', () => {
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO drafts (id, client_id, covers_through_message_id, draft_text, response_type, created_at)
       VALUES (?, 'c1', 'm1', 'text', 'gm_ack', ?)`
    );
    insert.run('d1', now);
    expect(() => insert.run('d2', now)).toThrow(/UNIQUE/);
    // resolving the first allows a new active draft
    db.prepare("UPDATE drafts SET status='sent', resolved_at=? WHERE id='d1'").run(now);
    expect(() => insert.run('d3', now)).not.toThrow();
  });

  it('CHECK constraints reject invalid enum values', () => {
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          "INSERT INTO compliance_days (client_id, date, status) VALUES ('c1', '2026-07-07', 'sortof')"
        )
        .run()
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO clients (id, display_name, timezone, status, created_at) VALUES ('c2', 'X', 'UTC', 'ghosted', ?)"
        )
        .run(now)
    ).toThrow(/CHECK/);
  });

  it('client deletion cascades to owned rows but audit events survive', () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO audit_events (id, client_id, actor, action, created_at) VALUES ('a1', 'c1', 'operator', 'verified', ?)"
    ).run(now);
    db.prepare("DELETE FROM clients WHERE id='c1'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get()).toEqual({ n: 1 });
  });
});
