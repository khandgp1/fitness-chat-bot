import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createComplianceRepo } from '../src/repos/complianceRepo.js';
import { createDraftRepo } from '../src/repos/draftRepo.js';
import { createMessageRepo } from '../src/repos/messageRepo.js';
import { withTransaction } from '../src/repos/tx.js';
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

describe('withTransaction', () => {
  it('rolls back on throw', () => {
    const before = clients.listByStatus().length;
    expect(() =>
      withTransaction(ctx.db, () => {
        clients.create({ displayName: 'Ghost', timezone: 'UTC' });
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(clients.listByStatus().length).toBe(before);
  });
});

describe('ClientRepo lifecycle', () => {
  it('creates as pending_verification, verifies, blocks — with audit rows', () => {
    const c = clients.create({ displayName: 'Mike', timezone: 'America/New_York' });
    expect(c.status).toBe('pending_verification');
    expect(c.verifiedAt).toBeUndefined();

    clients.verify(c.id);
    expect(clients.get(c.id)?.status).toBe('active');
    expect(clients.get(c.id)?.verifiedAt).toBeDefined();

    clients.block(c.id);
    expect(clients.get(c.id)?.status).toBe('blocked');

    const actions = audit.listEvents({ clientId: c.id }).map((e) => e.action);
    expect(actions).toContain('verified');
    expect(actions).toContain('blocked');
  });

  it('refuses to verify a non-pending client', () => {
    const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
    clients.verify(c.id);
    expect(() => clients.verify(c.id)).toThrow(/status 'active'/);
  });

  it('maps channel identities round-trip', () => {
    const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
    clients.registerIdentity(c.id, 'telegram', '829301', '@mike');
    expect(clients.findByIdentity('telegram', '829301')?.id).toBe(c.id);
    expect(clients.findByIdentity('telegram', 'nope')).toBeUndefined();
    // same external id twice violates UNIQUE
    expect(() => clients.registerIdentity(c.id, 'telegram', '829301')).toThrow(/UNIQUE/);
  });
});

describe('ClientRepo reset & delete', () => {
  function seedFullClient() {
    const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
    clients.verify(c.id);
    clients.registerIdentity(c.id, 'telegram', 'x1');
    const messages = createMessageRepo(ctx.db, ctx.clock, audit);
    const drafts = createDraftRepo(ctx.db, ctx.clock, audit);
    const compliance = createComplianceRepo(ctx.db, ctx.clock, audit);
    const m = messages.appendInbound({ clientId: c.id, text: 'GM' });
    const b = messages.openBatch(c.id);
    messages.assignToBatch(m.id, b.id);
    drafts.create({
      clientId: c.id,
      coversThroughMessageId: m.id,
      draftText: 'Morning.',
      responseType: 'gm_ack',
    });
    compliance.upsertDay({ clientId: c.id, date: '2026-07-07', status: 'compliant', streakAfter: 1 });
    clients.setLastReconciledDate(c.id, '2026-07-07');
    return c;
  }

  const count = (table: string, clientId: string): number =>
    (
      ctx.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE client_id = ?`)
        .get(clientId) as { n: number }
    ).n;

  it('reset wipes owned rows but keeps client, identities, and audit', () => {
    const c = seedFullClient();
    clients.reset(c.id);

    for (const t of ['messages', 'batches', 'drafts', 'compliance_days']) {
      expect(count(t, c.id), t).toBe(0);
    }
    expect(clients.get(c.id)?.status).toBe('active');
    expect(clients.get(c.id)?.lastReconciledDate).toBeUndefined();
    expect(clients.findByIdentity('telegram', 'x1')?.id).toBe(c.id);
    expect(audit.listEvents({ clientId: c.id }).map((e) => e.action)).toContain('reset');
  });

  it('delete removes the client and cascade, but audit survives', () => {
    const c = seedFullClient();
    clients.delete(c.id);

    expect(clients.get(c.id)).toBeUndefined();
    expect(clients.findByIdentity('telegram', 'x1')).toBeUndefined();
    expect(count('messages', c.id)).toBe(0);
    const actions = audit.listEvents({ clientId: c.id }).map((e) => e.action);
    expect(actions).toContain('deleted');
    expect(actions).toContain('verified'); // history intact
  });
});
