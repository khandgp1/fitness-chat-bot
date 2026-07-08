import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClock } from '../clock/clock.js';
import { loadConfig } from '../config/config.js';
import { openDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { createAuditRepo } from '../repos/auditRepo.js';
import { createClientRepo } from '../repos/clientRepo.js';
import { createComplianceRepo } from '../repos/complianceRepo.js';

const cfg = loadConfig();
mkdirSync(dirname(cfg.dbPath), { recursive: true });
const db = openDb(cfg.dbPath);
runMigrations(db, fileURLToPath(new URL('../../migrations', import.meta.url)));
const clock = createClock({ devMode: cfg.devMode, offsetFile: `${cfg.dbPath}.clock.json` });
const audit = createAuditRepo(db, clock);
const clients = createClientRepo(db, clock, audit);
const compliance = createComplianceRepo(db, clock, audit);

const [cmd, id, arg] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'list': {
      const all = clients.listByStatus();
      if (all.length === 0) console.log('(no clients)');
      for (const c of all) {
        console.log(
          `${c.id}  ${c.status.padEnd(20)} streak=${String(compliance.currentStreak(c.id)).padEnd(4)} tz=${c.timezone.padEnd(20)} ${c.displayName}`
        );
      }
      break;
    }
    case 'verify':
      requireId(id);
      clients.verify(id);
      console.log(`verified: ${id}`);
      break;
    case 'block':
      requireId(id);
      clients.block(id);
      console.log(`blocked: ${id}`);
      break;
    case 'set-timezone':
      requireId(id);
      if (arg === undefined) throw new Error('usage: clients set-timezone <id> <IANA tz>');
      clients.update(id, { timezone: arg });
      console.log(`timezone for ${id}: ${arg}`);
      break;
    default:
      console.log('usage: npm run clients -- <list | verify <id> | block <id> | set-timezone <id> <tz>>');
      process.exitCode = cmd === undefined ? 0 : 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}

function requireId(value: string | undefined): asserts value is string {
  if (value === undefined) throw new Error('client id required');
}
