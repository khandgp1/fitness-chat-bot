import { clientDate, type Clock } from '../clock/clock.js';
import type { Config } from '../config/config.js';
import type { Db } from '../db/connection.js';
import type { ClientRepo } from '../repos/clientRepo.js';
import type { ComplianceRepo } from '../repos/complianceRepo.js';
import type { NarrativeStore } from '../repos/narrativeStore.js';

/**
 * The unified triage model (Phase 3 §6, P3-8): every queue item is a pure
 * query over existing state — the queue itself stores nothing.
 */
export interface TriageItem {
  type:
    | 'awaiting_response'
    | 'pending_draft'
    | 'miss_followup'
    | 'pending_review'
    | 'narrative_staleness'
    | 'unverified';
  clientId: string;
  clientName: string;
  title: string;
  detail?: string;
  refs: { batchId?: string; draftId?: string; date?: string };
}

export function assembleTriage(deps: {
  db: Db;
  clock: Clock;
  cfg: Config;
  clients: ClientRepo;
  compliance: ComplianceRepo;
  narratives: NarrativeStore;
}): TriageItem[] {
  const items: TriageItem[] = [];
  const { db } = deps;

  // Awaiting response: processed reply-worthy batch, not dismissed, no covering live draft.
  const awaiting = db
    .prepare(
      `SELECT b.id AS batchId, b.client_id AS clientId, c.display_name AS name,
              b.primary_intent AS intent,
              (SELECT GROUP_CONCAT(m.text, ' · ') FROM messages m WHERE m.batch_id = b.id) AS preview
       FROM batches b JOIN clients c ON c.id = b.client_id
       WHERE b.status = 'processed' AND b.needs_response = 1 AND b.dismissed_at IS NULL
         AND c.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM drafts d
           WHERE d.client_id = b.client_id AND d.status IN ('draft', 'approved', 'sent')
             AND d.covers_through_message_id >= (SELECT MAX(m2.id) FROM messages m2 WHERE m2.batch_id = b.id)
         )
       ORDER BY b.id`
    )
    .all() as Array<{ batchId: string; clientId: string; name: string; intent: string; preview: string }>;
  for (const r of awaiting) {
    items.push({
      type: 'awaiting_response',
      clientId: r.clientId,
      clientName: r.name,
      title: `Awaiting response (${r.intent ?? 'unlabeled'})`,
      detail: r.preview ?? '',
      refs: { batchId: r.batchId },
    });
  }

  // Pending drafts.
  const pendingDrafts = db
    .prepare(
      `SELECT d.id AS draftId, d.client_id AS clientId, c.display_name AS name,
              d.draft_text AS text, d.response_type AS rtype
       FROM drafts d JOIN clients c ON c.id = d.client_id
       WHERE d.status = 'draft' ORDER BY d.id`
    )
    .all() as Array<{ draftId: string; clientId: string; name: string; text: string; rtype: string }>;
  for (const r of pendingDrafts) {
    items.push({
      type: 'pending_draft',
      clientId: r.clientId,
      clientName: r.name,
      title: `Draft ready (${r.rtype})`,
      detail: r.text,
      refs: { draftId: r.draftId },
    });
  }

  // Miss follow-ups (P3-2).
  for (const day of deps.compliance.listFollowupsPending()) {
    const client = deps.clients.get(day.clientId);
    if (client === undefined || client.status !== 'active') continue;
    items.push({
      type: 'miss_followup',
      clientId: day.clientId,
      clientName: client.displayName,
      title: `Missed ${day.date}`,
      detail: 'Streak reset — worth a follow-up?',
      refs: { date: day.date },
    });
  }

  // Pending reviews: held days from CLOSED days only (today may still resolve naturally).
  const pendingReviews = db
    .prepare(
      `SELECT cd.client_id AS clientId, cd.date AS date, c.display_name AS name, c.timezone AS tz
       FROM compliance_days cd JOIN clients c ON c.id = cd.client_id
       WHERE cd.status = 'pending_review' AND c.status = 'active' ORDER BY cd.date`
    )
    .all() as Array<{ clientId: string; date: string; name: string; tz: string }>;
  for (const r of pendingReviews) {
    if (r.date >= clientDate(r.tz, deps.clock.now())) continue;
    items.push({
      type: 'pending_review',
      clientId: r.clientId,
      clientName: r.name,
      title: `Pending review: ${r.date}`,
      detail: 'Classification never resolved — rule it valid GM or miss.',
      refs: { date: r.date },
    });
  }

  // Narrative staleness (D18 nudge) + unverified contacts.
  for (const client of deps.clients.listByStatus('active')) {
    const score = deps.narratives.stalenessScore(client.id);
    if (score.flags + score.replyWorthyBatches >= deps.cfg.stalenessThresholdExchanges) {
      items.push({
        type: 'narrative_staleness',
        clientId: client.id,
        clientName: client.displayName,
        title: 'Narrative falling behind',
        detail: `${score.flags} flag(s), ${score.replyWorthyBatches} unprocessed exchange(s) — run a design-plane /narrative-update`,
        refs: {},
      });
    }
  }
  for (const client of deps.clients.listByStatus('pending_verification')) {
    const preview = db
      .prepare('SELECT text FROM messages WHERE client_id = ? ORDER BY id DESC LIMIT 1')
      .get(client.id) as { text: string } | undefined;
    items.push({
      type: 'unverified',
      clientId: client.id,
      clientName: client.displayName,
      title: 'New unverified contact',
      detail: preview?.text,
      refs: {},
    });
  }

  return items;
}
