import 'dotenv/config';
import { loadConfig } from '../config/config.js';
import { createClock, DAY_MS, HOUR_MS } from '../clock/clock.js';

const cfg = loadConfig();
const clock = createClock({ devMode: cfg.devMode, offsetFile: `${cfg.dbPath}.clock.json` });

const [cmd, arg] = process.argv.slice(2);

function status(): void {
  const offsetH = clock.offsetMs() / HOUR_MS;
  console.log(`real now:      ${new Date().toISOString()}`);
  console.log(`effective now: ${clock.now().toISOString()}`);
  console.log(`offset:        ${offsetH >= 0 ? '+' : ''}${offsetH}h (${clock.offsetMs()} ms)`);
  console.log(`dev mode:      ${cfg.devMode}`);
}

try {
  switch (cmd) {
    case 'status':
      status();
      break;
    case 'advance-day':
      clock.advance(DAY_MS);
      status();
      break;
    case 'advance-hours': {
      const h = Number(arg);
      if (!Number.isFinite(h)) throw new Error(`advance-hours needs a numeric argument, got "${arg}"`);
      clock.advance(h * HOUR_MS);
      status();
      break;
    }
    case 'reset':
      clock.reset();
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
