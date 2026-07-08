import type { Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from './auditRepo.js';
import { newId } from './ids.js';
import { withTransaction } from './tx.js';
import type { Client, ClientStatus } from './types.js';

export interface ClientRepo {
  create(input: { displayName: string; timezone: string }): Client;
  get(id: string): Client | undefined;
  listByStatus(status?: ClientStatus): Client[];
  registerIdentity(clientId: string, channel: string, externalId: string, handle?: string): void;
  findByIdentity(channel: string, externalId: string): Client | undefined;
  getIdentity(clientId: string, channel: string): { externalId: string; handle?: string } | undefined;
  verify(id: string): void;
  block(id: string): void;
  update(id: string, patch: { displayName?: string; timezone?: string }): void;
  setLastReconciledDate(id: string, date: string): void;
  reset(id: string): void;
  delete(id: string): void;
}

export function createClientRepo(db: Db, clock: Clock, audit: AuditRepo): ClientRepo {
  const get = (id: string): Client | undefined => {
    const r = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r === undefined ? undefined : mapClient(r);
  };

  const requireClient = (id: string): Client => {
    const c = get(id);
    if (c === undefined) throw new Error(`Client not found: ${id}`);
    return c;
  };

  return {
    create(input) {
      const id = newId();
      db.prepare(
        `INSERT INTO clients (id, display_name, timezone, status, created_at)
         VALUES (?, ?, ?, 'pending_verification', ?)`
      ).run(id, input.displayName, input.timezone, clock.now().toISOString());
      return requireClient(id);
    },

    get,

    listByStatus(status) {
      const rows = (
        status === undefined
          ? db.prepare('SELECT * FROM clients ORDER BY id').all()
          : db.prepare('SELECT * FROM clients WHERE status = ? ORDER BY id').all(status)
      ) as Array<Record<string, unknown>>;
      return rows.map(mapClient);
    },

    registerIdentity(clientId, channel, externalId, handle) {
      requireClient(clientId);
      db.prepare(
        `INSERT INTO channel_identities (id, client_id, channel, external_id, handle, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(newId(), clientId, channel, externalId, handle ?? null, clock.now().toISOString());
    },

    findByIdentity(channel, externalId) {
      const r = db
        .prepare(
          `SELECT c.* FROM clients c
           JOIN channel_identities ci ON ci.client_id = c.id
           WHERE ci.channel = ? AND ci.external_id = ?`
        )
        .get(channel, externalId) as Record<string, unknown> | undefined;
      return r === undefined ? undefined : mapClient(r);
    },

    getIdentity(clientId, channel) {
      const r = db
        .prepare(
          'SELECT external_id, handle FROM channel_identities WHERE client_id = ? AND channel = ?'
        )
        .get(clientId, channel) as { external_id: string; handle: string | null } | undefined;
      return r === undefined
        ? undefined
        : { externalId: r.external_id, handle: r.handle ?? undefined };
    },

    verify(id) {
      withTransaction(db, () => {
        const c = requireClient(id);
        if (c.status !== 'pending_verification') {
          throw new Error(`Cannot verify client in status '${c.status}'`);
        }
        db.prepare("UPDATE clients SET status = 'active', verified_at = ? WHERE id = ?").run(
          clock.now().toISOString(),
          id
        );
        audit.event({ clientId: id, actor: 'operator', action: 'verified' });
      });
    },

    block(id) {
      withTransaction(db, () => {
        const c = requireClient(id);
        db.prepare("UPDATE clients SET status = 'blocked' WHERE id = ?").run(id);
        audit.event({ clientId: id, actor: 'operator', action: 'blocked', details: { from: c.status } });
      });
    },

    update(id, patch) {
      const c = requireClient(id);
      db.prepare('UPDATE clients SET display_name = ?, timezone = ? WHERE id = ?').run(
        patch.displayName ?? c.displayName,
        patch.timezone ?? c.timezone,
        id
      );
    },

    setLastReconciledDate(id, date) {
      requireClient(id);
      db.prepare('UPDATE clients SET last_reconciled_date = ? WHERE id = ?').run(date, id);
    },

    reset(id) {
      withTransaction(db, () => {
        requireClient(id);
        wipeOwnedRows(db, id);
        db.prepare('UPDATE clients SET last_reconciled_date = NULL WHERE id = ?').run(id);
        audit.event({ clientId: id, actor: 'operator', action: 'reset' });
      });
    },

    delete(id) {
      withTransaction(db, () => {
        requireClient(id);
        // Break the messages↔drafts FK cycle, then let ON DELETE CASCADE take the rest.
        wipeOwnedRows(db, id);
        db.prepare('DELETE FROM clients WHERE id = ?').run(id);
        audit.event({ clientId: id, actor: 'operator', action: 'deleted' });
      });
    },
  };
}

/**
 * Deletes everything a client owns except the client row, identities, and
 * audit history. Order matters: messages↔drafts reference each other, and
 * compliance_days/classifications reference messages/batches.
 */
function wipeOwnedRows(db: Db, clientId: string): void {
  db.prepare('UPDATE messages SET draft_id = NULL, batch_id = NULL WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM compliance_days WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM drafts WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM classifications WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM batches WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM messages WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM narrative_flags WHERE client_id = ?').run(clientId);
  db.prepare('DELETE FROM narrative_meta WHERE client_id = ?').run(clientId);
}

function mapClient(r: Record<string, unknown>): Client {
  return {
    id: r.id as string,
    displayName: r.display_name as string,
    timezone: r.timezone as string,
    status: r.status as ClientStatus,
    createdAt: r.created_at as string,
    verifiedAt: (r.verified_at as string | null) ?? undefined,
    lastReconciledDate: (r.last_reconciled_date as string | null) ?? undefined,
  };
}
