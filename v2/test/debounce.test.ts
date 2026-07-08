import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer, type Debouncer } from '../src/pipeline/debounce.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

const MINUTE_MS = 60_000;
const WINDOW = 3 * MINUTE_MS;

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;
let messages: MessageRepo;
let debouncer: Debouncer;
let onBatchClosed: ReturnType<typeof vi.fn>;

function newClient(name: string): string {
  const c = clients.create({ displayName: name, timezone: 'UTC' });
  clients.verify(c.id);
  return c.id;
}

/** Simulates an inbound message for an active client (what ingest does). */
function arrive(clientId: string, text: string): void {
  const m = messages.appendInbound({ clientId, text });
  const b = messages.openBatch(clientId);
  messages.assignToBatch(m.id, b.id);
  debouncer.touch(clientId);
}

beforeEach(() => {
  vi.useFakeTimers();
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  onBatchClosed = vi.fn();
  debouncer = createDebouncer(
    { db: ctx.db, clock: ctx.clock, messages },
    { debounceMs: WINDOW, onBatchClosed }
  );
});
afterEach(() => {
  debouncer.stop();
  vi.useRealTimers();
  ctx.cleanup();
});

describe('timer debounce', () => {
  it('a burst collapses into one batch, closed once, measured from the LAST message', () => {
    const mike = newClient('Mike');
    arrive(mike, 'GM');
    vi.advanceTimersByTime(WINDOW / 2);
    arrive(mike, 'also — question'); // resets the window
    vi.advanceTimersByTime(WINDOW / 2);
    expect(onBatchClosed).not.toHaveBeenCalled(); // only half a window since last msg

    vi.advanceTimersByTime(WINDOW / 2);
    expect(onBatchClosed).toHaveBeenCalledTimes(1);
    const pending = messages.listBatches(mike, 'pending');
    expect(pending).toHaveLength(1);
    expect(messages.list(mike).filter((m) => m.batchId === pending[0]!.id)).toHaveLength(2);
  });

  it('clients debounce independently', () => {
    const mike = newClient('Mike');
    const joe = newClient('Joe');
    arrive(mike, 'GM');
    vi.advanceTimersByTime(WINDOW / 2);
    arrive(joe, 'GM');
    vi.advanceTimersByTime(WINDOW / 2 + 1);
    expect(messages.listBatches(mike, 'pending')).toHaveLength(1);
    expect(messages.listBatches(joe, 'open')).toHaveLength(1); // joe's window still running
  });
});

describe('sweep (crash recovery)', () => {
  it('closes an orphaned open batch after a "restart", leaves fresh ones open', () => {
    const mike = newClient('Mike');
    const joe = newClient('Joe');
    arrive(mike, 'GM before crash');

    // crash: timers die with the process
    debouncer.stop();
    debouncer = createDebouncer(
      { db: ctx.db, clock: ctx.clock, messages },
      { debounceMs: WINDOW, onBatchClosed }
    );

    // mike's batch outlives the window (dev clock drives sweep age)
    ctx.clock.advance(WINDOW + MINUTE_MS);
    arrive(joe, 'fresh message'); // fresh open batch at the new clock time

    const swept = debouncer.sweep();
    expect(swept).toBe(1);
    expect(messages.listBatches(mike, 'pending')).toHaveLength(1);
    expect(messages.listBatches(joe, 'open')).toHaveLength(1);
  });

  it('sweep is a no-op when nothing is overdue', () => {
    const mike = newClient('Mike');
    arrive(mike, 'GM');
    expect(debouncer.sweep()).toBe(0);
  });

  it('rearm resumes a not-yet-overdue batch after a quick restart (operator-found gap)', () => {
    const mike = newClient('Mike');
    arrive(mike, 'GM before crash');

    // crash + QUICK restart: window has NOT elapsed
    debouncer.stop();
    ctx.clock.advance(WINDOW / 2);
    debouncer = createDebouncer(
      { db: ctx.db, clock: ctx.clock, messages },
      { debounceMs: WINDOW, onBatchClosed }
    );

    expect(debouncer.sweep()).toBe(0); // correctly not overdue yet
    expect(debouncer.rearm()).toBe(1); // but the window resumes

    vi.advanceTimersByTime(WINDOW / 2 - 1000);
    expect(messages.listBatches(mike, 'open')).toHaveLength(1); // remaining time honored
    vi.advanceTimersByTime(2000);
    expect(messages.listBatches(mike, 'pending')).toHaveLength(1); // closed on schedule
  });

  it('rearm never double-arms a client with a live timer', () => {
    const mike = newClient('Mike');
    arrive(mike, 'GM'); // touch() armed a timer
    expect(debouncer.rearm()).toBe(0);
  });
});
