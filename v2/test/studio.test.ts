import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDbReadOnly, type Db } from '../src/db/connection.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createComplianceRepo } from '../src/repos/complianceRepo.js';
import { createDraftRepo } from '../src/repos/draftRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { createNarrativeStore, type NarrativeStore } from '../src/repos/narrativeStore.js';
import {
  buildCalibrationReport,
  buildStudioContext,
  resolveNarrative,
  type StudioReadDeps,
} from '../src/studio/studio.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;
let messages: MessageRepo;
let narratives: NarrativeStore;
let roDb: Db;
let clientId: string;

const roDeps = (): StudioReadDeps => {
  const roAudit = createAuditRepo(roDb, ctx.clock);
  return {
    db: roDb,
    clock: ctx.clock,
    clients: createClientRepo(roDb, ctx.clock, roAudit),
    messages: createMessageRepo(roDb, ctx.clock, roAudit),
    compliance: createComplianceRepo(roDb, ctx.clock, roAudit),
    narratives: createNarrativeStore(roDb, ctx.clock, roAudit, {
      narrativesDir: join(ctx.dir, 'narratives'),
    }),
  };
};

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  narratives = createNarrativeStore(ctx.db, ctx.clock, audit, {
    narrativesDir: join(ctx.dir, 'narratives'),
  });
  const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
  clients.verify(c.id);
  clientId = c.id;
  roDb = openDbReadOnly(join(ctx.dir, 'test.sqlite'));
});
afterEach(() => {
  roDb.close();
  ctx.cleanup();
});

describe('read-only discipline (Phase 1 §2.9)', () => {
  it('a write through the read connection throws — impossible by construction', () => {
    expect(() =>
      roDb.prepare("UPDATE clients SET display_name = 'hacked' WHERE id = ?").run(clientId)
    ).toThrow(/readonly/i);
    expect(clients.get(clientId)!.displayName).toBe('Mike');
  });
});

describe('buildStudioContext', () => {
  it('contains narrative, flags, compliance, conversation-since-watermark, and calibration', () => {
    narratives.quickEdit(clientId, '## Snapshot\nNight-shift nurse.\n', 'operator');
    narratives.addFlag(clientId, 'started night shifts', 'agent');
    const compliance = createComplianceRepo(ctx.db, ctx.clock, audit);
    compliance.upsertDay({ clientId, date: '2026-07-06', status: 'compliant', streakAfter: 1 });
    const m = messages.appendInbound({ clientId, text: 'can I train fasted?' });
    const drafts = createDraftRepo(ctx.db, ctx.clock, audit);
    const d = drafts.create({
      clientId,
      coversThroughMessageId: m.id,
      draftText: 'Yes, light sessions are fine fasted.',
      responseType: 'coaching_answer',
      confidence: 0.9,
    });
    drafts.markSent(d.id, 'Yes — but keep it light and see how you feel.');

    const out = buildStudioContext(roDeps(), clientId);
    expect(out).toContain('Night-shift nurse.');
    expect(out).toContain('started night shifts');
    expect(out).toContain('2026-07-06: compliant');
    expect(out).toContain('CLIENT: can I train fasted?');
    expect(out).toContain('EDITED (coaching_answer)');
    expect(out).toContain('(never resolved)');
  });

  it('conversation respects the watermark', () => {
    messages.appendInbound({ clientId, text: 'old news' });
    ctx.clock.advance(60_000);
    narratives.setWatermark(clientId, ctx.clock.now().toISOString());
    ctx.clock.advance(60_000);
    messages.appendInbound({ clientId, text: 'fresh material' });

    const out = buildStudioContext(roDeps(), clientId);
    expect(out).toContain('fresh material');
    expect(out).not.toContain('old news');
  });
});

describe('buildCalibrationReport', () => {
  it('aggregates drafts by type and router dismissals', () => {
    const b = messages.openBatch(clientId);
    messages.closeBatch(b.id);
    messages.markBatchProcessed(b.id, {
      primaryIntent: 'status_update',
      routerConfidence: 0.7,
      needsResponse: true,
    });
    messages.dismissBatch(b.id);

    const out = buildCalibrationReport(roDeps());
    expect(out).toContain('status_update: 1 batches · 1 dismissed');
  });
});

describe('resolveNarrative — the only design-plane write', () => {
  it('advances the watermark, clears covered flags, audits — atomically', () => {
    narratives.addFlag(clientId, 'durable fact', 'agent');
    const watermark = resolveNarrative(
      { db: ctx.db, clock: ctx.clock, narratives, audit, clients },
      clientId
    );
    expect(narratives.getWatermark(clientId)).toBe(watermark);
    expect(narratives.listUnclearedFlags(clientId)).toEqual([]);
    const event = audit.listEvents({ clientId }).find((e) => e.action === 'narrative_resolved')!;
    expect((event.details as { watermark: string }).watermark).toBe(watermark);
  });

  it('rejects an unknown client, leaving nothing behind', () => {
    expect(() =>
      resolveNarrative({ db: ctx.db, clock: ctx.clock, narratives, audit, clients }, 'nope')
    ).toThrow(/not found/i);
    expect(audit.listEvents().find((e) => e.action === 'narrative_resolved')).toBeUndefined();
  });
});
