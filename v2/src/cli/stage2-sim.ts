/**
 * Stage 2 Verify walkthrough: a simulated month of compliance.
 * Run: npx tsx src/cli/stage2-sim.ts
 * Own throwaway DB under data/ — safe to re-run. Includes a mid-simulation
 * process "restart" (connection closed, everything rebuilt) to prove state
 * lives entirely in the database.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Clock } from '../clock/clock.js';
import { DAY_MS } from '../clock/clock.js';
import { openDb, type Db } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { createComplianceEngine, dateAdd } from '../domain/compliance.js';
import { createAuditRepo } from '../repos/auditRepo.js';
import { createClientRepo } from '../repos/clientRepo.js';
import { createComplianceRepo } from '../repos/complianceRepo.js';

const DB = 'data/stage2-demo.sqlite';
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
mkdirSync('data', { recursive: true });

// Simulated clock: starts noon New York on Jun 30, advanced a day at a time.
let nowMs = Date.parse('2026-06-30T16:00:00Z');
const clock: Clock = {
  now: () => new Date(nowMs),
  offsetMs: () => 0,
  advance: (ms) => (nowMs += ms),
  reset: () => {},
};

function buildStack(): { db: Db; engine: ReturnType<typeof createComplianceEngine>; deps: ReturnType<typeof buildRepos> } {
  const db = openDb(DB);
  runMigrations(db, fileURLToPath(new URL('../../migrations', import.meta.url)));
  const deps = buildRepos(db);
  const engine = createComplianceEngine({ db, clock, ...deps });
  return { db, engine, deps };
}
function buildRepos(db: Db) {
  const audit = createAuditRepo(db, clock);
  return {
    audit,
    clients: createClientRepo(db, clock, audit),
    compliance: createComplianceRepo(db, clock, audit),
  };
}

let stack = buildStack();

console.log('=== Setup: client verified on 2026-06-30 (America/New_York)');
const client = stack.deps.clients.create({ displayName: 'Sim Mike', timezone: 'America/New_York' });
stack.deps.clients.verify(client.id);
clock.advance(DAY_MS); // move to 07-01 — the script's first day

// The scripted month. Silent days simply advance the clock — like real downtime.
const script: Array<[string, () => void, string]> = [
  ['2026-07-01', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-02', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-03', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-04', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-05', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-06', () => {}, '(silent — will close as miss)'],
  ['2026-07-07', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-08', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-09', () => stack.engine.recordClassificationFailure(client.id), 'classification FAILURE (pending review, never resolved)'],
  ['2026-07-10', () => stack.engine.recordValidGm(client.id), 'GM'],
  ['2026-07-11', () => {}, '(server down)'],
  ['2026-07-12', () => {}, '(server down)'],
  ['2026-07-13', () => {}, '(server down)'],
  ['2026-07-14', () => {
    console.log('    >>> PROCESS RESTART: closing DB, rebuilding everything from disk');
    stack.db.close();
    stack = buildStack();
    stack.engine.recordValidGm(client.id);
    stack.engine.recordValidGm(client.id); // duplicate GM same day
  }, 'restart, then GM (twice — duplicate)'],
];

console.log('\n=== Playing the month');
for (const [date, action, label] of script) {
  console.log(`  ${date}: ${label}`);
  action();
  clock.advance(DAY_MS);
}
stack.engine.reconcile(client.id);

console.log('\n=== Compliance calendar');
const days = stack.deps.compliance.listDays(client.id, '2026-06-30', '2026-07-15');
const byDate = new Map(days.map((d) => [d.date, d]));
for (let d = '2026-06-30'; d <= '2026-07-14'; d = dateAdd(d, 1)) {
  const day = byDate.get(d);
  if (day === undefined) {
    const note = d === '2026-06-30' ? '(verification day — grace, never closed)' : '(today — never closed early)';
    console.log(`  ${d}  —            ${note}`);
    continue;
  }
  const streak = day.streakAfter === undefined ? 'HELD' : String(day.streakAfter);
  const followup = day.followupState === 'pending' ? '  → follow-up pending in triage' : '';
  console.log(`  ${d}  ${day.status.padEnd(15)} streak=${streak}${followup}`);
}

console.log(`\ncurrent streak: ${stack.deps.compliance.currentStreak(client.id)}`);
console.log(`pending follow-ups: ${stack.deps.compliance.listFollowupsPending().length}`);
console.log(`\nExpected: 5-streak → miss 07-06 → 2-streak → held 07-09 → streak 3 on 07-10`);
console.log(`          → misses 07-11..13 (follow-ups) → streak 1 on 07-14 (duplicate GM counted once)`);
stack.db.close();
