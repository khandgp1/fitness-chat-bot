/**
 * Stage 1 Verify walkthrough (PHASE_4_ROADMAP Stage 1 checkpoint).
 * Run: npx tsx src/cli/stage1-walkthrough.ts
 * Uses its own throwaway DB + narratives dir under data/ — safe to re-run.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClock } from '../clock/clock.js';
import { openDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { createAuditRepo } from '../repos/auditRepo.js';
import { createClientRepo } from '../repos/clientRepo.js';
import { createDraftRepo, ActiveDraftExistsError } from '../repos/draftRepo.js';
import { createMessageRepo } from '../repos/messageRepo.js';
import { createNarrativeStore } from '../repos/narrativeStore.js';

const DB = 'data/stage1-demo.sqlite';
const NARRATIVES = 'data/stage1-demo-narratives';
rmSync(DB, { force: true });
rmSync(`${DB}-wal`, { force: true });
rmSync(`${DB}-shm`, { force: true });
rmSync(NARRATIVES, { recursive: true, force: true });
mkdirSync('data', { recursive: true });

const db = openDb(DB);
runMigrations(db, fileURLToPath(new URL('../../migrations', import.meta.url)));
const clock = createClock({ devMode: true, offsetFile: `${DB}.clock.json` });
const audit = createAuditRepo(db, clock);
const clients = createClientRepo(db, clock, audit);
const messages = createMessageRepo(db, clock, audit);
const drafts = createDraftRepo(db, clock, audit);
const narratives = createNarrativeStore(db, clock, audit, { narrativesDir: NARRATIVES });

const step = (n: string) => console.log(`\n=== ${n}`);

step('1. Seed a client (arrives unverified), then verify');
const c = clients.create({ displayName: 'Demo Mike', timezone: 'America/New_York' });
clients.registerIdentity(c.id, 'telegram', '12345', '@demomike');
console.log(`created: ${c.id} status=${c.status}`);
clients.verify(c.id);
console.log(`after verify: status=${clients.get(c.id)!.status}`);

step('2. Inbound messages → batch');
const m1 = messages.appendInbound({ clientId: c.id, text: 'GM' });
const m2 = messages.appendInbound({ clientId: c.id, text: 'can I swap rice for sweet potato?' });
const b = messages.openBatch(c.id);
messages.assignToBatch(m1.id, b.id);
messages.assignToBatch(m2.id, b.id);
messages.closeBatch(b.id);
messages.markBatchProcessed(b.id, {
  primaryIntent: 'coaching_question',
  routerConfidence: 0.92,
  needsResponse: true,
});
console.log(`batch ${b.id}: ${messages.getBatch(b.id)!.status}, intent=${messages.getBatch(b.id)!.primaryIntent}`);

step('3. Create a draft; watch the DB refuse a second one');
const d = drafts.create({
  clientId: c.id,
  coversThroughMessageId: m2.id,
  draftText: 'Yes, that is a direct 1-to-1 swap. Keep the portion size the same.',
  responseType: 'coaching_answer',
  confidence: 0.9,
});
console.log(`draft created: ${d.id}`);
try {
  drafts.create({ clientId: c.id, coversThroughMessageId: m2.id, draftText: 'dup', responseType: 'coaching_answer' });
} catch (err) {
  console.log(`second draft refused: ${err instanceof ActiveDraftExistsError ? 'ActiveDraftExistsError' : err}`);
}

step('4. Freshness: a new inbound makes the draft stale-able');
console.log(`fresh before: ${drafts.isFresh(drafts.get(d.id)!)}`);
messages.appendInbound({ clientId: c.id, text: 'oh and one more thing...' });
console.log(`fresh after new inbound: ${drafts.isFresh(drafts.get(d.id)!)}`);
drafts.markStale(d.id);

step('5. Narrative quick edit → git commit in the narratives dir');
narratives.quickEdit(c.id, '## Snapshot\nDemo client, tests the walkthrough.\n\n## Current Focus\nDaily GM.\n', 'operator');
console.log(execFileSync('git', ['log', '--oneline'], { cwd: NARRATIVES, encoding: 'utf8' }).trim());

step('6. Reset the client: rows wiped, audit survives');
clients.reset(c.id);
const count = (t: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE client_id = ?`).get(c.id) as { n: number }).n;
console.log(`messages=${count('messages')} batches=${count('batches')} drafts=${count('drafts')}`);
console.log(`audit events for client: ${audit.listEvents({ clientId: c.id, limit: 100 }).length}`);
console.log(`actions: ${audit.listEvents({ clientId: c.id, limit: 100 }).map((e) => e.action).reverse().join(' → ')}`);

console.log(`\nDone. Inspect ${DB} with any SQLite browser; narratives git repo at ${NARRATIVES}.`);
db.close();
