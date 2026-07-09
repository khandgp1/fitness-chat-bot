import 'dotenv/config';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadConfig } from '../config/config.js';
import { openDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';

const cfg = loadConfig();
const yes = process.argv.slice(2).includes('--yes');

const targets = [
  cfg.dbPath,
  `${cfg.dbPath}-wal`,
  `${cfg.dbPath}-shm`,
  `${cfg.dbPath}.clock.json`,
  `${cfg.dbPath}.snapshot`,
  cfg.narrativesDir,
];

console.log('This will permanently delete:');
for (const t of targets) console.log(`  ${t}`);

try {
  if (!yes) {
    console.log('\nusage: npm run reset-all -- --yes   (nothing deleted; pass --yes to proceed)');
    process.exitCode = 1;
  } else {
    // D22 fresh-start bootstrap requires exclusive access to the DB file;
    // checkpointing here surfaces "server still running" as an error instead
    // of silently deleting out from under a live process.
    if (existsSync(cfg.dbPath)) {
      const db = new Database(cfg.dbPath);
      db.pragma('busy_timeout = 2000');
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } finally {
        db.close();
      }
    }

    for (const t of targets) rmSync(t, { recursive: true, force: true });
    mkdirSync(cfg.narrativesDir, { recursive: true });

    const db = openDb(cfg.dbPath);
    const { applied, version } = runMigrations(
      db,
      fileURLToPath(new URL('../../migrations', import.meta.url))
    );
    db.close();

    console.log(`\ndb recreated:       ${cfg.dbPath}`);
    console.log(`migrations applied: ${applied.length ? applied.join(', ') : '(none)'}`);
    console.log(`schema version:     ${version}`);
    console.log(`narratives dir:     ${cfg.narrativesDir} (empty)`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  console.error('\nIf the v2 server is still running, stop it first — reset-all needs exclusive access to the database.');
  process.exitCode = 1;
}
