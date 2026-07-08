import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGmClassifier } from '../src/agents/gmClassifier.js';
import { createFakeLlmClient, type FakeLlmClient } from '../src/agents/llmClient.js';
import { createRouter } from '../src/agents/router.js';
import { createComplianceEngine } from '../src/domain/compliance.js';
import { createProcessor, type Processor } from '../src/pipeline/process.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createComplianceRepo, type ComplianceRepo } from '../src/repos/complianceRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { createPromptStore } from '../src/repos/promptStore.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

// Test clock starts 2026-07-07T12:00Z; UTC client → today is 2026-07-07.
const TODAY = '2026-07-07';

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;
let messages: MessageRepo;
let compliance: ComplianceRepo;
let llm: FakeLlmClient;
let processor: Processor;
let clientId: string;

const ROUTER_OK = {
  primary_intent: 'gm_checkin',
  confidence: 0.95,
  needs_response: false,
  reasoning: 'bare check-in',
};
const GM_VALID = { is_valid_gm: true, reasoning: 'clear GM' };

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  compliance = createComplianceRepo(ctx.db, ctx.clock, audit);
  const engine = createComplianceEngine({ db: ctx.db, clock: ctx.clock, clients, compliance, audit });

  const promptsDir = join(ctx.dir, 'prompts');
  mkdirSync(promptsDir);
  for (const f of ['router.md', 'gm_classifier.md', 'gm_classifier_examples.md']) {
    writeFileSync(join(promptsDir, f), `${f} content\n`);
  }
  const prompts = createPromptStore({ promptsDir });

  llm = createFakeLlmClient();
  processor = createProcessor({
    clock: ctx.clock,
    clients,
    messages,
    compliance,
    engine,
    router: createRouter({ llm, prompts, audit, model: 'haiku-test' }),
    classifier: createGmClassifier({ llm, prompts, audit, model: 'haiku-test' }),
    classifierModel: 'haiku-test',
    retryGraceMs: 0,
  });

  const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
  clients.verify(c.id);
  clientId = c.id;
});
afterEach(() => ctx.cleanup());

/** Ingest-shaped batch: messages assigned, batch closed to pending. */
function makeBatch(...texts: string[]): string {
  const batch = messages.openBatch(clientId);
  for (const text of texts) {
    const m = messages.appendInbound({ clientId, text });
    messages.assignToBatch(m.id, batch.id);
  }
  messages.closeBatch(batch.id);
  return batch.id;
}

const calledTools = () => llm.requests.map((r) => r.tool.name);

describe('processBatch', () => {
  it('bare GM: compliant day + processed batch, both agents called in parallel', async () => {
    llm.enqueue('classify_gm', GM_VALID);
    llm.enqueue('classify_batch', ROUTER_OK);
    const batchId = makeBatch('GM');

    await processor.processBatch(batchId);

    expect(compliance.getDay(clientId, TODAY)?.status).toBe('compliant');
    expect(compliance.currentStreak(clientId)).toBe(1);
    const batch = messages.getBatch(batchId)!;
    expect(batch.status).toBe('processed');
    expect(batch.primaryIntent).toBe('gm_checkin');
    expect(batch.needsResponse).toBe(false);
    expect(compliance.listClassifications(batchId)[0]!.isValidGm).toBe(true);
    expect(audit.listLlmCalls()).toHaveLength(2);
  });

  it('mixed burst serves both paths (D23)', async () => {
    llm.enqueue('classify_gm', GM_VALID);
    llm.enqueue('classify_batch', {
      primary_intent: 'coaching_question',
      confidence: 0.88,
      needs_response: true,
      reasoning: 'substance wins',
    });
    const batchId = makeBatch('GM', 'can I swap rice for sweet potato?');

    await processor.processBatch(batchId);

    expect(compliance.currentStreak(clientId)).toBe(1);
    const batch = messages.getBatch(batchId)!;
    expect(batch.primaryIntent).toBe('coaching_question');
    expect(batch.needsResponse).toBe(true);
  });

  it('already-compliant day short-circuits the classifier (D9)', async () => {
    llm.enqueue('classify_gm', GM_VALID);
    llm.enqueue('classify_batch', ROUTER_OK);
    await processor.processBatch(makeBatch('GM'));
    expect(compliance.currentStreak(clientId)).toBe(1);

    llm.requests.length = 0;
    llm.enqueue('classify_batch', {
      primary_intent: 'status_update',
      confidence: 0.8,
      needs_response: true,
      reasoning: 'reports workout',
    });
    await processor.processBatch(makeBatch('crushed the workout'));

    expect(calledTools()).toEqual(['classify_batch']); // no classify_gm
    expect(compliance.currentStreak(clientId)).toBe(1); // unchanged
  });

  it('classifier error → pending review + NULL classification row (conservative)', async () => {
    llm.enqueue('classify_gm', new Error('api down'));
    llm.enqueue('classify_batch', ROUTER_OK);
    const batchId = makeBatch('GM');

    await processor.processBatch(batchId);

    expect(compliance.getDay(clientId, TODAY)?.status).toBe('pending_review');
    expect(compliance.getDay(clientId, TODAY)?.streakAfter).toBeUndefined(); // held
    expect(compliance.listClassifications(batchId)[0]!.isValidGm).toBeUndefined();
    expect(messages.getBatch(batchId)!.status).toBe('processed'); // router path unaffected
  });

  it('router error → batch stays pending; retry processes it without re-classifying', async () => {
    llm.enqueue('classify_gm', GM_VALID);
    llm.enqueue('classify_batch', new Error('overloaded'));
    const batchId = makeBatch('GM');

    await processor.processBatch(batchId);

    expect(compliance.currentStreak(clientId)).toBe(1); // classifier path succeeded
    expect(messages.getBatch(batchId)!.status).toBe('pending'); // never lost, never mislabeled

    // retry: day now compliant → classifier skipped; router succeeds
    llm.requests.length = 0;
    llm.enqueue('classify_batch', ROUTER_OK);
    ctx.clock.advance(1000); // past the (zero) grace cutoff
    const retried = await processor.retryPending();
    expect(retried).toBe(1);
    expect(calledTools()).toEqual(['classify_batch']);
    expect(messages.getBatch(batchId)!.status).toBe('processed');
  });

  it('re-processing a processed batch is a no-op', async () => {
    llm.enqueue('classify_gm', GM_VALID);
    llm.enqueue('classify_batch', ROUTER_OK);
    const batchId = makeBatch('GM');
    await processor.processBatch(batchId);

    llm.requests.length = 0;
    await processor.processBatch(batchId); // no queued responses needed
    expect(llm.requests).toHaveLength(0);
  });

  it('malformed router output stays pending (same path as API error)', async () => {
    llm.enqueue('classify_gm', GM_VALID);
    llm.enqueue('classify_batch', { primary_intent: 'gm_checkin' }); // missing fields
    const batchId = makeBatch('GM');
    await processor.processBatch(batchId);
    expect(messages.getBatch(batchId)!.status).toBe('pending');
  });
});
