import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/config.js';
import { openDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';

const cfg = loadConfig();
mkdirSync(dirname(cfg.dbPath), { recursive: true });

const db = openDb(cfg.dbPath);
const { applied, version } = runMigrations(db, fileURLToPath(new URL('../../migrations', import.meta.url)));
db.close();

console.log(`db:      ${cfg.dbPath}`);
console.log(`applied: ${applied.length ? applied.join(', ') : '(none — already up to date)'}`);
console.log(`version: ${version}`);
