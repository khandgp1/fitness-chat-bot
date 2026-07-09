import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS } from '../src/clock/clock.js';
import { openDb } from '../src/db/connection.js';
import { backupNow, latestBackupDate, pruneBackups, runDailyBackup } from '../src/ops/backup.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createNarrativeStore } from '../src/repos/narrativeStore.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
});
afterEach(() => ctx.cleanup());

describe('unblock', () => {
  it('verified-then-blocked returns to active; audited', () => {
    const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
    clients.verify(c.id);
    clients.block(c.id);
    clients.unblock(c.id);
    expect(clients.get(c.id)!.status).toBe('active');
    const e = audit.listEvents({ clientId: c.id }).find((ev) => ev.action === 'unblocked')!;
    expect((e.details as { to: string }).to).toBe('active');
  });

  it('never-verified-blocked returns to the verification gate', () => {
    const c = clients.create({ displayName: 'Stranger', timezone: 'UTC' });
    clients.block(c.id);
    clients.unblock(c.id);
    expect(clients.get(c.id)!.status).toBe('pending_verification');
  });

  it('refuses on a non-blocked client', () => {
    const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
    expect(() => clients.unblock(c.id)).toThrow(/status 'pending_verification'/);
  });
});

describe('daily backup', () => {
  const paths = () => ({
    dbPath: join(ctx.dir, 'test.sqlite'),
    narrativesDir: join(ctx.dir, 'narratives'),
  });

  it('creates a consistent copy while the DB is open, including narratives', () => {
    const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
    createNarrativeStore(ctx.db, ctx.clock, audit, { narrativesDir: paths().narrativesDir }).quickEdit(
      c.id,
      '## Snapshot\nreal content\n',
      'operator'
    );

    const target = runDailyBackup({ ...paths(), clock: ctx.clock })!;
    expect(target).toContain('2026-07-07');

    // the copied DB opens and contains the row — consistency proof
    const copy = openDb(join(target, 'test.sqlite'));
    const n = copy.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number };
    copy.close();
    expect(n.n).toBe(1);
    expect(existsSync(join(target, 'narratives', `${c.id}.md`))).toBe(true);
  });

  it('is idempotent per day and runs again the next (dev-clock) day', () => {
    expect(runDailyBackup({ ...paths(), clock: ctx.clock })).toBeDefined();
    expect(runDailyBackup({ ...paths(), clock: ctx.clock })).toBeUndefined(); // same day: no-op
    ctx.clock.advance(DAY_MS);
    expect(runDailyBackup({ ...paths(), clock: ctx.clock })).toContain('2026-07-08');
  });

  it('prunes to the newest N and reports the latest', () => {
    const backupsDir = join(ctx.dir, 'backups');
    for (let i = 1; i <= 16; i++) {
      mkdirSync(join(backupsDir, `2026-06-${String(i).padStart(2, '0')}`), { recursive: true });
    }
    expect(pruneBackups(backupsDir, 14)).toBe(2);
    const left = readdirSync(backupsDir).sort();
    expect(left).toHaveLength(14);
    expect(left[0]).toBe('2026-06-03'); // oldest two gone
    expect(latestBackupDate(backupsDir)).toBe('2026-06-16');
  });

  it('backupNow tolerates a missing narratives dir', () => {
    const target = backupNow({
      dbPath: join(ctx.dir, 'test.sqlite'),
      narrativesDir: join(ctx.dir, 'nope'),
      backupsDir: join(ctx.dir, 'backups'),
      date: '2026-07-07',
    });
    expect(existsSync(join(target, 'test.sqlite'))).toBe(true);
    expect(existsSync(join(target, 'narratives'))).toBe(false);
  });
});
