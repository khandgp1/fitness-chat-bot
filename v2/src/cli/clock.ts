import 'dotenv/config';
import { existsSync } from 'node:fs';
import { loadConfig } from '../config/config.js';
import { createClock, DAY_MS, HOUR_MS } from '../clock/clock.js';
import { restoreSnapshot, snapshotExists, takeSnapshot } from '../dev/snapshot.js';

const cfg = loadConfig();
const offsetFile = `${cfg.dbPath}.clock.json`;
const [cmd, arg] = process.argv.slice(2);

// Clock instances are created after any snapshot work so status always
// reflects the files as they are now.
const makeClock = () => createClock({ devMode: cfg.devMode, offsetFile });

function status(): void {
  const clock = makeClock();
  const offsetH = clock.offsetMs() / HOUR_MS;
  console.log(`real now:      ${new Date().toISOString()}`);
  console.log(`effective now: ${clock.now().toISOString()}`);
  console.log(`offset:        ${offsetH >= 0 ? '+' : ''}${offsetH}h (${clock.offsetMs()} ms)`);
  console.log(`dev mode:      ${cfg.devMode}`);
  console.log(`snapshot:      ${snapshotExists(cfg.dbPath) ? 'exists (reset will restore it)' : 'none'}`);
}

// D20: the first advance of a simulation snapshots DB + clock together.
function snapshotBeforeFirstAdvance(): void {
  if (!cfg.devMode) return; // advance will throw anyway
  if (existsSync(cfg.dbPath) && !snapshotExists(cfg.dbPath)) {
    takeSnapshot(cfg.dbPath);
    console.log(`snapshot taken: ${cfg.dbPath}.snapshot/`);
  }
}

try {
  switch (cmd) {
    case 'status':
      status();
      break;
    case 'advance-day':
      snapshotBeforeFirstAdvance();
      makeClock().advance(DAY_MS);
      status();
      break;
    case 'advance-hours': {
      const h = Number(arg);
      if (!Number.isFinite(h)) throw new Error(`advance-hours needs a numeric argument, got "${arg}"`);
      snapshotBeforeFirstAdvance();
      makeClock().advance(h * HOUR_MS);
      status();
      break;
    }
    case 'reset':
      if (snapshotExists(cfg.dbPath)) {
        if (!cfg.devMode) throw new Error('Clock.reset is not allowed outside dev mode');
        restoreSnapshot(cfg.dbPath);
        console.log('snapshot restored: db + clock returned to pre-simulation state');
      } else {
        makeClock().reset();
      }
      status();
      break;
    default:
      console.log('usage: npm run clock -- <status | advance-day | advance-hours <n> | reset>');
      process.exitCode = cmd === undefined ? 0 : 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
