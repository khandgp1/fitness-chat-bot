import type { ChannelAdapter } from '../adapters/types.js';
import type { Coach } from '../agents/coach.js';
import type { Db } from '../db/connection.js';
import type { ClientRepo } from '../repos/clientRepo.js';
import { ActiveDraftExistsError, type DraftRepo } from '../repos/draftRepo.js';
import type { MessageRepo } from '../repos/messageRepo.js';
import { withTransaction } from '../repos/tx.js';
import type { Draft } from '../repos/types.js';

/** The send-time freshness check refused (D19): client spoke after the draft. */
export class StaleDraftError extends Error {
  constructor(draftId: string) {
    super(`Draft ${draftId} is stale — new inbound messages arrived after it was drafted`);
    this.name = 'StaleDraftError';
  }
}

/**
 * The operator's Level-0 surface: trigger a draft, send (possibly edited),
 * reject. Send order is DELIVER-THEN-RECORD: a crash between the two can
 * double-send on retry (loud, operator-visible), but the reverse would mark
 * undelivered messages as sent — a silent audit lie. Stage 5 spec, Design Notes.
 */
export interface DraftService {
  triggerDraft(clientId: string): Promise<Draft>;
  send(draftId: string, finalText?: string): Promise<void>;
  reject(draftId: string): void;
}

export function createDraftService(deps: {
  db: Db;
  clients: ClientRepo;
  messages: MessageRepo;
  drafts: DraftRepo;
  coach: Coach;
  adapter: ChannelAdapter;
}): DraftService {
  return {
    async triggerDraft(clientId) {
      const client = deps.clients.get(clientId);
      if (client === undefined) throw new Error(`Client not found: ${clientId}`);
      if (client.status !== 'active') {
        throw new Error(`Drafts require an active client (${clientId} is '${client.status}')`);
      }
      if (deps.drafts.getActive(clientId) !== undefined) {
        throw new ActiveDraftExistsError(clientId);
      }
      return deps.coach.draft(clientId);
    },

    async send(draftId, finalText) {
      const draft = deps.drafts.get(draftId);
      if (draft === undefined) throw new Error(`Draft not found: ${draftId}`);
      if (draft.status !== 'draft') {
        throw new Error(`Cannot send draft ${draftId} in status '${draft.status}'`);
      }
      const text = finalText ?? draft.draftText;

      // D19: never send a reply that predates what the client last said.
      if (!deps.drafts.isFresh(draft)) {
        deps.drafts.markStale(draftId);
        throw new StaleDraftError(draftId);
      }

      const identity = deps.clients.getIdentity(draft.clientId, deps.adapter.name);
      if (identity === undefined) {
        throw new Error(`Client ${draft.clientId} has no ${deps.adapter.name} identity`);
      }

      await deps.adapter.send(identity.externalId, text); // deliver...
      withTransaction(deps.db, () => {
        // ...then record (markSent audits, including the edited flag)
        deps.drafts.markSent(draftId, text);
        deps.messages.appendOutbound({ clientId: draft.clientId, text, draftId });
      });
    },

    reject(draftId) {
      deps.drafts.markRejected(draftId);
    },
  };
}
