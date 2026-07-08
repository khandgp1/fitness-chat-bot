/**
 * The design plane's tool surface (Phase 1 §2.9). Reads use a READ-ONLY
 * connection; `resolve` is the only write; `snapshot` guards direct file
 * edits with the daily pre-image.
 * Usage: npm run studio -- <init | clients | context <id> | calibration [--client <id>] | snapshot <id> | resolve <id> [--ts ISO]>
 */
import 'dotenv/config';
import { createClock } from '../clock/clock.js';
import { loadConfig } from '../config/config.js';
import { openDb, openDbReadOnly, type Db } from '../db/connection.js';
import { createAuditRepo } from '../repos/auditRepo.js';
import { createClientRepo } from '../repos/clientRepo.js';
import { createComplianceRepo } from '../repos/complianceRepo.js';
import { createMessageRepo } from '../repos/messageRepo.js';
import { createNarrativeStore } from '../repos/narrativeStore.js';
import {
  buildCalibrationReport,
  buildStudioContext,
  initNarrativesDir,
  listClientsWithStaleness,
  resolveNarrative,
} from '../studio/studio.js';

const cfg = loadConfig();
const clock = createClock({ devMode: cfg.devMode, offsetFile: `${cfg.dbPath}.clock.json` });
const [cmd, id, ...rest] = process.argv.slice(2);

function repos(db: Db) {
  const audit = createAuditRepo(db, clock);
  return {
    db,
    clock,
    audit,
    clients: createClientRepo(db, clock, audit),
    messages: createMessageRepo(db, clock, audit),
    compliance: createComplianceRepo(db, clock, audit),
    narratives: createNarrativeStore(db, clock, audit, { narrativesDir: cfg.narrativesDir }),
  };
}

let db: Db | undefined;
try {
  switch (cmd) {
    case 'init':
      console.log(`initialized: ${initNarrativesDir(cfg.narrativesDir)}`);
      break;
    case 'clients':
      db = openDbReadOnly(cfg.dbPath);
      console.log(listClientsWithStaleness(repos(db)));
      break;
    case 'context':
      requireArg(id);
      db = openDbReadOnly(cfg.dbPath);
      console.log(buildStudioContext(repos(db), id));
      break;
    case 'calibration': {
      db = openDbReadOnly(cfg.dbPath);
      const flag = rest.indexOf('--client');
      const clientId = flag >= 0 ? rest[flag + 1] : id === '--client' ? rest[0] : undefined;
      console.log(buildCalibrationReport(repos(db), clientId));
      break;
    }
    case 'snapshot': {
      requireArg(id);
      db = openDb(cfg.dbPath); // store needs a normal handle; snapshot itself is file-only
      const taken = repos(db).narratives.snapshotDaily(id);
      console.log(taken ? 'pre-image snapshot taken for today' : 'no snapshot needed (none to take, or today’s already exists)');
      break;
    }
    case 'resolve': {
      requireArg(id);
      db = openDb(cfg.dbPath); // the design plane's ONLY write path
      const tsFlag = rest.indexOf('--ts');
      const deps = repos(db);
      const watermark = resolveNarrative(deps, id, tsFlag >= 0 ? rest[tsFlag + 1] : undefined);
      console.log(`resolved: watermark → ${watermark}, covered flags cleared`);
      break;
    }
    default:
      console.log(
        'usage: npm run studio -- <init | clients | context <id> | calibration [--client <id>] | snapshot <id> | resolve <id> [--ts ISO]>'
      );
      process.exitCode = cmd === undefined ? 0 : 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db?.close();
}

function requireArg(value: string | undefined): asserts value is string {
  if (value === undefined) throw new Error('client id required');
}
