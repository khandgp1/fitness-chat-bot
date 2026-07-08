import { clientDate, type Clock } from '../clock/clock.js';
import type { GmClassifier } from '../agents/gmClassifier.js';
import type { Router } from '../agents/router.js';
import type { ComplianceEngine } from '../domain/compliance.js';
import type { ClientRepo } from '../repos/clientRepo.js';
import type { ComplianceRepo } from '../repos/complianceRepo.js';
import type { MessageRepo } from '../repos/messageRepo.js';

/**
 * Processes a pending batch (Phase 1 §2.2 step 5): two independent Haiku
 * calls in parallel (D23) —
 *   classifier → compliance state machine (skipped only by the D9 short-circuit)
 *   router     → batch labeling for triage (never a compliance input)
 * Error semantics: classifier failure → pending review (conservative);
 * router failure → batch stays `pending` and the tick retries it. Everything
 * is idempotent, so re-processing is always safe.
 */
export interface Processor {
  processBatch(batchId: string): Promise<void>;
  retryPending(): Promise<number>;
}

const DEFAULT_RETRY_GRACE_MS = 5 * 60 * 1000;

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error })
  );

export function createProcessor(deps: {
  clock: Clock;
  clients: ClientRepo;
  messages: MessageRepo;
  compliance: ComplianceRepo;
  engine: ComplianceEngine;
  router: Router;
  classifier: GmClassifier;
  classifierModel: string;
  retryGraceMs?: number;
}): Processor {
  const graceMs = deps.retryGraceMs ?? DEFAULT_RETRY_GRACE_MS;

  return {
    async processBatch(batchId) {
      const batch = deps.messages.getBatch(batchId);
      if (batch === undefined || batch.status !== 'pending') return; // idempotence guard
      const client = deps.clients.get(batch.clientId);
      if (client === undefined || client.status !== 'active') return; // blocked mid-flight: leave it

      const batchMessages = deps.messages.listByBatch(batchId);
      if (batchMessages.length === 0) {
        // Swept-empty edge case: nothing to classify, nothing to answer.
        deps.messages.markBatchProcessed(batchId, {
          primaryIntent: 'other',
          routerConfidence: 1,
          needsResponse: false,
        });
        return;
      }
      const batchText = batchMessages.map((m) => m.text).join('\n');
      const lastMessageId = batchMessages[batchMessages.length - 1]!.id;
      const ctx = { clientId: client.id, batchId };

      // D9 short-circuit: the classifier's only gate is a DB read.
      const today = clientDate(client.timezone, deps.clock.now());
      const alreadyCompliant = deps.compliance.getDay(client.id, today)?.status === 'compliant';

      // Parallel, independently settled (D23).
      const routerP = settle(deps.router.run(batchText, ctx));
      const classifierP = alreadyCompliant ? null : settle(deps.classifier.run(batchText, ctx));

      // Compliance path — errors resolve conservatively to pending review.
      if (classifierP !== null) {
        const c = await classifierP;
        if (c.ok) {
          deps.compliance.recordClassification({
            clientId: client.id,
            batchId,
            isValidGm: c.value.isValidGm,
            reasoning: c.value.reasoning,
            model: deps.classifierModel,
          });
          if (c.value.isValidGm) deps.engine.recordValidGm(client.id, lastMessageId);
        } else {
          deps.compliance.recordClassification({
            clientId: client.id,
            batchId,
            model: deps.classifierModel, // NULL verdict = failure
          });
          deps.engine.recordClassificationFailure(client.id);
        }
      }

      // Response path — a failed router leaves the batch pending for retry.
      const r = await routerP;
      if (r.ok) {
        deps.messages.markBatchProcessed(batchId, {
          primaryIntent: r.value.primaryIntent,
          routerConfidence: r.value.confidence,
          needsResponse: r.value.needsResponse,
        });
      }
    },

    async retryPending() {
      const cutoff = new Date(deps.clock.now().getTime() - graceMs).toISOString();
      const stale = deps.messages.listStalePendingBatches(cutoff);
      for (const batch of stale) {
        await this.processBatch(batch.id);
      }
      return stale.length;
    },
  };
}
