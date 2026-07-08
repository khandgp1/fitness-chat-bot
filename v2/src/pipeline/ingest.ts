import type { InboundMessage } from '../adapters/types.js';
import type { Db } from '../db/connection.js';
import type { AuditRepo } from '../repos/auditRepo.js';
import type { ClientRepo } from '../repos/clientRepo.js';
import type { MessageRepo } from '../repos/messageRepo.js';
import { withTransaction } from '../repos/tx.js';
import type { Debouncer } from './debounce.js';

/**
 * The inbound gate (Phase 1 §2.2, D10). Order is load-bearing:
 * resolve/auto-register → PERSIST → gate on status → batch + debounce.
 *   blocked              → nothing stored, silently ignored
 *   pending_verification → stored only; surfaces via the unverified triage query
 *   active               → stored + assigned to the open batch + debounce touch
 */
export interface Ingestor {
  handle(msg: InboundMessage): {
    stored: boolean;
    clientId: string;
    gated: 'blocked' | 'unverified' | 'batched';
  };
}

export function createIngestor(deps: {
  db: Db;
  clients: ClientRepo;
  messages: MessageRepo;
  audit: AuditRepo;
  debouncer: Debouncer;
  defaultTimezone: string;
}): Ingestor {
  const { db, clients, messages, audit, debouncer, defaultTimezone } = deps;

  return {
    handle(msg) {
      const result = withTransaction(db, () => {
        let client = clients.findByIdentity(msg.channel, msg.externalId);
        if (client === undefined) {
          client = clients.create({
            displayName: msg.displayName ?? msg.handle ?? `${msg.channel}:${msg.externalId}`,
            timezone: defaultTimezone,
          });
          clients.registerIdentity(client.id, msg.channel, msg.externalId, msg.handle);
          audit.event({
            clientId: client.id,
            actor: 'system',
            action: 'auto_registered',
            details: { channel: msg.channel, externalId: msg.externalId, handle: msg.handle },
          });
        }

        if (client.status === 'blocked') {
          return { stored: false, clientId: client.id, gated: 'blocked' as const };
        }

        const message = messages.appendInbound({
          clientId: client.id,
          text: msg.text,
          channelMessageRef: msg.channelMessageRef,
          rawPayload: msg.rawPayload,
        });

        if (client.status !== 'active') {
          return { stored: true, clientId: client.id, gated: 'unverified' as const };
        }

        const batch = messages.openBatch(client.id);
        messages.assignToBatch(message.id, batch.id);
        return { stored: true, clientId: client.id, gated: 'batched' as const };
      });

      // Timer side effects stay outside the transaction.
      if (result.gated === 'batched') debouncer.touch(result.clientId);
      return result;
    },
  };
}
