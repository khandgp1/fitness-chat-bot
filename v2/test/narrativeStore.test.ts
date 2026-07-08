import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../src/clock/clock.js';
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

const histDir = () => join(narrativesDir, 'history', clientId);
const snapshots = () => (existsSync(histDir()) ? readdirSync(histDir()).sort() : []);

describe('content + daily pre-image snapshots (D15/D16 as revised)', () => {
  it('writes, audits, and takes at most one pre-image per day — preserving the pre-edit content', () => {
    store.quickEdit(clientId, 'v1: original\n', 'operator');
    expect(store.read(clientId).content).toContain('v1');
    expect(snapshots()).toEqual([]); // first-ever write: nothing to preserve

    ctx.clock.advance(HOUR_MS);
    store.quickEdit(clientId, 'v2: first edit today\n', 'operator');
    expect(snapshots()).toEqual(['2026-07-07.md']);
    expect(readFileSync(join(histDir(), '2026-07-07.md'), 'utf8')).toContain('v1'); // the PRE-image

    ctx.clock.advance(HOUR_MS);
    store.quickEdit(clientId, 'v3: second edit same day\n', 'operator');
    expect(snapshots()).toEqual(['2026-07-07.md']); // coalesced — still one
    expect(readFileSync(join(histDir(), '2026-07-07.md'), 'utf8')).toContain('v1'); // unchanged

    ctx.clock.advance(DAY_MS);
    store.quickEdit(clientId, 'v4: next day\n', 'operator');
    expect(snapshots()).toEqual(['2026-07-07.md', '2026-07-08.md']);
    expect(readFileSync(join(histDir(), '2026-07-08.md'), 'utf8')).toContain('v3'); // start-of-day-2 state

    expect(audit.listEvents({ clientId }).filter((e) => e.action === 'narrative_quick_edit')).toHaveLength(4);
  });

  it('snapshotDaily guards direct file edits the same way', () => {
    store.quickEdit(clientId, 'before a design-plane session\n', 'operator');
    ctx.clock.advance(HOUR_MS);
    expect(store.snapshotDaily(clientId)).toBe(true); // the skill's pre-edit guard
    expect(store.snapshotDaily(clientId)).toBe(false); // idempotent within the day
    expect(readFileSync(join(histDir(), '2026-07-07.md'), 'utf8')).toContain('before a design-plane session');
  });

  it('no git anywhere in the narrative path', () => {
    store.quickEdit(clientId, 'content\n', 'operator');
    expect(existsSync(join(narrativesDir, '.git'))).toBe(false);
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

    expect(store.stalenessScore(clientId)).toEqual({ flags: 1, replyWorthyBatches: 1 });

    ctx.clock.advance(HOUR_MS);
    store.setWatermark(clientId, ctx.clock.now().toISOString());
    expect(store.stalenessScore(clientId)).toEqual({ flags: 0, replyWorthyBatches: 0 });
  });
});
