import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOUR_MS } from '../src/clock/clock.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo } from '../src/repos/clientRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { createNarrativeStore, type NarrativeStore } from '../src/repos/narrativeStore.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let store: NarrativeStore;
let messages: MessageRepo;
let clientId: string;
let narrativesDir: string;

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  narrativesDir = join(ctx.dir, 'narratives');
  store = createNarrativeStore(ctx.db, ctx.clock, audit, { narrativesDir });
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  const clients = createClientRepo(ctx.db, ctx.clock, audit);
  clientId = clients.create({ displayName: 'Mike', timezone: 'UTC' }).id;
});
afterEach(() => ctx.cleanup());

const gitLog = (): string =>
  execFileSync('git', ['log', '--oneline'], { cwd: narrativesDir, encoding: 'utf8' }).trim();

describe('content via file + git', () => {
  it('quickEdit auto-inits the repo, writes, commits, audits', () => {
    expect(store.read(clientId).content).toBeUndefined();
    store.quickEdit(clientId, '## Snapshot\nNew client.\n', 'operator');

    expect(existsSync(join(narrativesDir, '.git'))).toBe(true);
    expect(store.read(clientId).content).toContain('New client.');
    expect(gitLog()).toContain(`narrative(${clientId})`);
    expect(audit.listEvents({ clientId }).map((e) => e.action)).toContain('narrative_quick_edit');
  });

  it('an identical rewrite creates no empty commit', () => {
    store.quickEdit(clientId, 'same\n', 'operator');
    const commits = gitLog().split('\n').length;
    store.quickEdit(clientId, 'same\n', 'operator');
    expect(gitLog().split('\n').length).toBe(commits);
  });
});

describe('watermark & flags (D18)', () => {
  it('setWatermark clears only flags at or before it', () => {
    store.addFlag(clientId, 'started night shifts', 'agent');
    const tsBetween = new Date(ctx.clock.now().getTime() + HOUR_MS).toISOString();
    ctx.clock.advance(2 * HOUR_MS);
    store.addFlag(clientId, 'injured shoulder', 'operator');

    store.setWatermark(clientId, tsBetween);
    const uncleared = store.listUnclearedFlags(clientId);
    expect(uncleared.map((f) => f.note)).toEqual(['injured shoulder']);
    expect(store.getWatermark(clientId)).toBe(tsBetween);
  });

  it('stalenessScore counts uncleared flags + reply-worthy batches since watermark', () => {
    store.addFlag(clientId, 'note', 'agent');
    const b1 = messages.openBatch(clientId);
    messages.closeBatch(b1.id);
    messages.markBatchProcessed(b1.id, {
      primaryIntent: 'coaching_question',
      routerConfidence: 0.9,
      needsResponse: true,
    });

    // no watermark yet: everything counts
    expect(store.stalenessScore(clientId)).toEqual({ flags: 1, replyWorthyBatches: 1 });

    // watermark after that batch: batch no longer counts, flag cleared
    ctx.clock.advance(HOUR_MS);
    store.setWatermark(clientId, ctx.clock.now().toISOString());
    expect(store.stalenessScore(clientId)).toEqual({ flags: 0, replyWorthyBatches: 0 });

    // new reply-worthy batch after watermark counts again
    ctx.clock.advance(HOUR_MS);
    const b2 = messages.openBatch(clientId);
    messages.closeBatch(b2.id);
    messages.markBatchProcessed(b2.id, {
      primaryIntent: 'status_update',
      routerConfidence: 0.8,
      needsResponse: true,
    });
    expect(store.stalenessScore(clientId).replyWorthyBatches).toBe(1);
  });
});
