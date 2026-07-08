import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeAdapter, type FakeAdapter } from '../src/adapters/fake.js';
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config/config.js';

let dir: string;
let app: App;
let adapter: FakeAdapter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'app-test-'));
  adapter = createFakeAdapter();
  const cfg = loadConfig({
    DB_PATH: join(dir, 'app.sqlite'),
    NARRATIVES_DIR: join(dir, 'narratives'),
    DEBOUNCE_MINUTES: '1',
  });
  app = buildApp({ cfg, adapter });
});
afterEach(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('composition root', () => {
  it('boots (migrate → reconcile → sweep → adapter) and ingests end-to-end', async () => {
    await app.start();

    adapter.deliver({ externalId: 'e2e-1', text: 'hello' });
    const client = app.deps.clients.findByIdentity('fake', 'e2e-1')!;
    expect(client.status).toBe('pending_verification');
    expect(app.deps.messages.list(client.id)).toHaveLength(1);

    app.deps.clients.verify(client.id);
    adapter.deliver({ externalId: 'e2e-1', text: 'GM' });
    expect(app.deps.messages.listBatches(client.id, 'open')).toHaveLength(1);
  });

  it('a second boot on the same DB sweeps the orphaned batch', async () => {
    await app.start();
    adapter.deliver({ externalId: 'e2e-1', text: 'hello' });
    const client = app.deps.clients.findByIdentity('fake', 'e2e-1')!;
    app.deps.clients.verify(client.id);
    adapter.deliver({ externalId: 'e2e-1', text: 'GM' });
    await app.stop(); // "crash": open batch left behind

    // next boot, one debounce-window later
    const adapter2 = createFakeAdapter();
    const cfg2 = loadConfig({
      DB_PATH: join(dir, 'app.sqlite'),
      NARRATIVES_DIR: join(dir, 'narratives'),
      DEBOUNCE_MINUTES: '0', // window elapsed: everything open is overdue
    });
    app = buildApp({ cfg: cfg2, adapter: adapter2 });
    await app.start();
    expect(app.deps.messages.listBatches(client.id, 'pending')).toHaveLength(1);
  });
});
