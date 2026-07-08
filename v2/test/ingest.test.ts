import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAdapter, type FakeAdapter } from '../src/adapters/fake.js';
import { createDebouncer, type Debouncer } from '../src/pipeline/debounce.js';
import { createIngestor, type Ingestor } from '../src/pipeline/ingest.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;
let messages: MessageRepo;
let debouncer: Debouncer;
let ingestor: Ingestor;
let adapter: FakeAdapter;
const onBatchClosed = vi.fn();

beforeEach(async () => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  debouncer = createDebouncer(
    { db: ctx.db, clock: ctx.clock, messages },
    { debounceMs: 60_000, onBatchClosed }
  );
  ingestor = createIngestor({
    db: ctx.db,
    clients,
    messages,
    audit,
    debouncer,
    defaultTimezone: 'America/New_York',
  });
  adapter = createFakeAdapter();
  await adapter.start((msg) => ingestor.handle(msg));
  onBatchClosed.mockClear();
});
afterEach(() => {
  debouncer.stop();
  ctx.cleanup();
});

describe('gating (D10)', () => {
  it('a stranger is auto-registered pending_verification: stored, no batch, audited', () => {
    adapter.deliver({ externalId: 'stranger-1', text: 'hey coach', rawPayload: '{"raw":true}' });

    const client = clients.findByIdentity('fake', 'stranger-1')!;
    expect(client.status).toBe('pending_verification');
    expect(client.timezone).toBe('America/New_York');

    const stored = messages.list(client.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.rawPayload).toBe('{"raw":true}');
    expect(messages.listBatches(client.id)).toHaveLength(0); // gated: no pipeline

    expect(audit.listEvents({ clientId: client.id }).map((e) => e.action)).toContain(
      'auto_registered'
    );
  });

  it('a second message from the same stranger reuses the client', () => {
    adapter.deliver({ externalId: 'stranger-1', text: 'one' });
    adapter.deliver({ externalId: 'stranger-1', text: 'two' });
    expect(clients.listByStatus()).toHaveLength(1);
    expect(messages.list(clients.listByStatus()[0]!.id)).toHaveLength(2);
  });

  it('an active client gets batched', () => {
    adapter.deliver({ externalId: 'mike', text: 'first contact' });
    const client = clients.findByIdentity('fake', 'mike')!;
    clients.verify(client.id);

    adapter.deliver({ externalId: 'mike', text: 'GM' });
    const batches = messages.listBatches(client.id, 'open');
    expect(batches).toHaveLength(1);
    const batched = messages.list(client.id).filter((m) => m.batchId === batches[0]!.id);
    expect(batched.map((m) => m.text)).toEqual(['GM']); // pre-verification message not batched
  });

  it('a blocked client leaves no trace', () => {
    adapter.deliver({ externalId: 'spammer', text: 'buy now' });
    const client = clients.findByIdentity('fake', 'spammer')!;
    clients.block(client.id);
    const before = messages.list(client.id).length;

    adapter.deliver({ externalId: 'spammer', text: 'buy now!!' });
    expect(messages.list(client.id)).toHaveLength(before); // nothing stored
  });

  it('falls back to channel:externalId for a nameless sender', () => {
    adapter.deliver({ externalId: 'x9', text: 'hi' });
    expect(clients.findByIdentity('fake', 'x9')!.displayName).toBe('fake:x9');
  });

  it('uses handle/displayName when present', () => {
    adapter.deliver({ externalId: 'y1', text: 'hi', displayName: 'Mike R', handle: '@mike' });
    expect(clients.findByIdentity('fake', 'y1')!.displayName).toBe('Mike R');
  });
});
