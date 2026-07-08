import { clientDate, DAY_MS, type Clock } from '../clock/clock.js';
import { dateAdd } from '../domain/compliance.js';
import type { ClientRepo } from '../repos/clientRepo.js';
import type { ComplianceRepo } from '../repos/complianceRepo.js';
import type { MessageRepo } from '../repos/messageRepo.js';
import type { NarrativeStore } from '../repos/narrativeStore.js';

/**
 * The coach's pushed context (Phase 2 §4): narrative whole, computed
 * compliance block, recent conversation verbatim with the unanswered span
 * marked. Deeper history is PULLED via tools, never pushed.
 */
export interface ContextBuilder {
  build(clientId: string): string;
}

export const UNANSWERED_MARKER = '--- UNANSWERED — everything below still needs a reply ---';

export function createContextBuilder(
  deps: {
    clock: Clock;
    clients: ClientRepo;
    messages: MessageRepo;
    compliance: ComplianceRepo;
    narratives: NarrativeStore;
  },
  opts: { maxMessages: number; maxDays: number }
): ContextBuilder {
  return {
    build(clientId) {
      const client = deps.clients.get(clientId);
      if (client === undefined) throw new Error(`Client not found: ${clientId}`);

      const narrative =
        deps.narratives.read(clientId).content ?? '(no narrative on file for this client yet)';

      // Compliance block — cheap SQL, rendered compact.
      const today = clientDate(client.timezone, deps.clock.now());
      const streak = deps.compliance.currentStreak(clientId);
      const week = deps.compliance
        .listDays(clientId, dateAdd(today, -6), today)
        .map((d) => `${d.date}: ${d.status}`)
        .join('\n');
      const todayStatus = deps.compliance.getDay(clientId, today)?.status ?? 'unknown';

      // Recent conversation: newest N, then oldest-first; bounded by age too.
      const cutoffTs = new Date(deps.clock.now().getTime() - opts.maxDays * DAY_MS).toISOString();
      const window = deps.messages
        .list(clientId, { limit: opts.maxMessages })
        .filter((m) => m.createdAt >= cutoffTs)
        .reverse();

      const lastOutboundIdx = window.reduce(
        (acc, m, i) => (m.direction === 'outbound' ? i : acc),
        -1
      );
      const lines: string[] = [];
      window.forEach((m, i) => {
        if (i === lastOutboundIdx + 1) lines.push(UNANSWERED_MARKER);
        const who = m.direction === 'inbound' ? 'CLIENT' : 'COACH';
        lines.push(`[${m.createdAt}] ${who}: ${m.text}`);
      });
      if (window.length === 0) lines.push('(no recent messages)');

      return [
        '## Client narrative',
        narrative.trim(),
        '',
        '## Compliance',
        `current streak: ${streak}`,
        `today (${today}): ${todayStatus}`,
        'last 7 days:',
        week || '(no history)',
        '',
        '## Recent conversation (oldest first)',
        ...lines,
      ].join('\n');
    },
  };
}
