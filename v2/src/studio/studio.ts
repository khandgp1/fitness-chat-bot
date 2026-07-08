import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientDate, type Clock } from '../clock/clock.js';
import type { Db } from '../db/connection.js';
import { dateAdd } from '../domain/compliance.js';
import type { AuditRepo } from '../repos/auditRepo.js';
import type { ClientRepo } from '../repos/clientRepo.js';
import type { ComplianceRepo } from '../repos/complianceRepo.js';
import type { MessageRepo } from '../repos/messageRepo.js';
import type { NarrativeStore } from '../repos/narrativeStore.js';
import { withTransaction } from '../repos/tx.js';

/**
 * Design-plane core (Phase 1 §2.9). Reads run against a READ-ONLY connection
 * (caller's responsibility — the CLI opens one); resolveNarrative is the
 * plane's only DB write: watermark + flag clearing + audit, one transaction.
 */
export interface StudioReadDeps {
  db: Db; // read-only connection
  clock: Clock;
  clients: ClientRepo;
  messages: MessageRepo;
  compliance: ComplianceRepo;
  narratives: NarrativeStore;
}

export function listClientsWithStaleness(deps: StudioReadDeps): string {
  const rows = deps.clients.listByStatus().map((c) => {
    const s = deps.narratives.stalenessScore(c.id);
    return `${c.id}  ${c.status.padEnd(20)} staleness=${s.flags + s.replyWorthyBatches} (${s.flags} flags, ${s.replyWorthyBatches} exchanges)  ${c.displayName}`;
  });
  return rows.length > 0 ? rows.join('\n') : '(no clients)';
}

export function buildStudioContext(deps: StudioReadDeps, clientId: string): string {
  const client = deps.clients.get(clientId);
  if (client === undefined) throw new Error(`Client not found: ${clientId}`);

  const narrative = deps.narratives.read(clientId);
  const watermark = deps.narratives.getWatermark(clientId);
  const flags = deps.narratives.listUnclearedFlags(clientId);
  const today = clientDate(client.timezone, deps.clock.now());
  const days = deps.compliance.listDays(clientId, dateAdd(today, -29), today);
  const conversation = deps.messages
    .list(clientId, { limit: 200 })
    .filter((m) => watermark === undefined || m.createdAt > watermark)
    .reverse();

  const calibration = deps.db
    .prepare(
      `SELECT response_type, status, draft_text, final_text, created_at FROM drafts
       WHERE client_id = ? AND status IN ('sent', 'rejected') ORDER BY id DESC LIMIT 15`
    )
    .all(clientId) as Array<{
    response_type: string;
    status: string;
    draft_text: string;
    final_text: string | null;
    created_at: string;
  }>;
  const calibrationLines = calibration.map((d) => {
    if (d.status === 'rejected') return `REJECTED (${d.response_type}): "${d.draft_text}"`;
    return d.final_text !== null && d.final_text !== d.draft_text
      ? `EDITED (${d.response_type}): drafted "${d.draft_text}" → sent "${d.final_text}"`
      : `SENT AS-IS (${d.response_type}): "${d.draft_text}"`;
  });
  const dismissed = (
    deps.db
      .prepare(
        `SELECT COUNT(*) AS n FROM batches WHERE client_id = ? AND dismissed_at IS NOT NULL`
      )
      .get(clientId) as { n: number }
  ).n;

  return [
    `# Studio context: ${client.displayName} (${clientId})`,
    `status: ${client.status} · tz: ${client.timezone} · streak: ${deps.compliance.currentStreak(clientId)}`,
    `narrative watermark: ${watermark ?? '(never resolved)'}`,
    '',
    '## Current narrative',
    narrative.content?.trim() ?? '(no narrative on file)',
    '',
    '## Uncleared flags (agent-noticed, durable-looking facts)',
    flags.length > 0 ? flags.map((f) => `- [${f.createdAt}] ${f.note}`).join('\n') : '(none)',
    '',
    '## Compliance — last 30 days',
    days.length > 0
      ? days.map((d) => `${d.date}: ${d.status}${d.followupState === 'pending' ? ' (follow-up pending)' : ''}`).join('\n')
      : '(no history)',
    '',
    `## Conversation since watermark (${conversation.length} messages)`,
    conversation.length > 0
      ? conversation
          .map((m) => `[${m.createdAt}] ${m.direction === 'inbound' ? 'CLIENT' : 'COACH'}: ${m.text}`)
          .join('\n')
      : '(nothing new since the watermark)',
    '',
    `## Calibration record (operator edits are signal; ${dismissed} batch(es) dismissed as not reply-worthy)`,
    calibrationLines.length > 0 ? calibrationLines.join('\n') : '(no resolved drafts yet)',
  ].join('\n');
}

export function buildCalibrationReport(deps: StudioReadDeps, clientId?: string): string {
  const where = clientId !== undefined ? 'WHERE d.client_id = ?' : '';
  const args = clientId !== undefined ? [clientId] : [];
  const byType = deps.db
    .prepare(
      `SELECT d.response_type AS t,
              COUNT(*) AS total,
              SUM(CASE WHEN d.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN d.status = 'sent' AND d.final_text != d.draft_text THEN 1 ELSE 0 END) AS edited,
              SUM(CASE WHEN d.status = 'sent' AND d.final_text = d.draft_text THEN 1 ELSE 0 END) AS asis,
              AVG(d.confidence) AS conf
       FROM drafts d ${where} GROUP BY d.response_type`
    )
    .all(...args) as Array<{ t: string; total: number; rejected: number; edited: number; asis: number; conf: number | null }>;

  const router = deps.db
    .prepare(
      `SELECT primary_intent AS intent, COUNT(*) AS total,
              SUM(CASE WHEN dismissed_at IS NOT NULL THEN 1 ELSE 0 END) AS dismissed,
              AVG(router_confidence) AS conf
       FROM batches WHERE status = 'processed' GROUP BY primary_intent`
    )
    .all() as Array<{ intent: string | null; total: number; dismissed: number; conf: number | null }>;

  const recentEdits = deps.db
    .prepare(
      `SELECT response_type, draft_text, final_text FROM drafts
       WHERE status = 'sent' AND final_text != draft_text ORDER BY id DESC LIMIT 10`
    )
    .all() as Array<{ response_type: string; draft_text: string; final_text: string }>;

  return [
    `# Calibration report${clientId !== undefined ? ` (client ${clientId})` : ' (all clients)'}`,
    '',
    '## Coach drafts by response type',
    byType.length > 0
      ? byType
          .map(
            (r) =>
              `${r.t}: ${r.total} total · sent as-is ${r.asis} · edited ${r.edited} · rejected ${r.rejected} · avg confidence ${r.conf?.toFixed(2) ?? '—'}`
          )
          .join('\n')
      : '(no drafts yet)',
    '',
    '## Router (needs_response calibration: dismissals = false positives)',
    router
      .map((r) => `${r.intent ?? '(unlabeled)'}: ${r.total} batches · ${r.dismissed} dismissed · avg confidence ${r.conf?.toFixed(2) ?? '—'}`)
      .join('\n') || '(no processed batches)',
    '',
    '## Recent operator edits (draft → sent)',
    recentEdits.length > 0
      ? recentEdits.map((e) => `(${e.response_type}) "${e.draft_text}" → "${e.final_text}"`).join('\n')
      : '(none)',
  ].join('\n');
}

/** The design plane's only DB write (D18): one transaction, audited. */
export function resolveNarrative(
  deps: { db: Db; clock: Clock; narratives: NarrativeStore; audit: AuditRepo; clients: ClientRepo },
  clientId: string,
  ts?: string
): string {
  const client = deps.clients.get(clientId);
  if (client === undefined) throw new Error(`Client not found: ${clientId}`);
  const watermark = ts ?? deps.clock.now().toISOString();
  withTransaction(deps.db, () => {
    deps.narratives.setWatermark(clientId, watermark);
    deps.audit.event({
      clientId,
      actor: 'operator',
      action: 'narrative_resolved',
      details: { watermark },
    });
  });
  return watermark;
}

export function initNarrativesDir(narrativesDir: string): string {
  mkdirSync(join(narrativesDir, 'history'), { recursive: true });
  const readme = join(narrativesDir, 'README.md');
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      '# Client narratives\n\nPrivate client data (D16 as revised 2026-07-08): gitignored via `data/`,\nnever committed, never pushed. One `<clientId>.md` per client; daily\npre-image snapshots under `history/<clientId>/<YYYY-MM-DD>.md`.\nErasure procedure: see `Claude/STUDIO.md`.\n'
    );
  }
  return narrativesDir;
}
