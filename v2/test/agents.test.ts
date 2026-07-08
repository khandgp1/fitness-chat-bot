import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGmClassifier } from '../src/agents/gmClassifier.js';
import { createFakeLlmClient, type FakeLlmClient } from '../src/agents/llmClient.js';
import { createRouter, validateRouterResult } from '../src/agents/router.js';
import { validateClassifierResult } from '../src/agents/gmClassifier.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo } from '../src/repos/clientRepo.js';
import { createMessageRepo } from '../src/repos/messageRepo.js';
import { createPromptStore, type PromptStore } from '../src/repos/promptStore.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let llm: FakeLlmClient;
let prompts: PromptStore;
let promptsDir: string;
let CTX: { clientId: string; batchId: string };

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  // llm_calls rows carry real FKs — use a real client + batch
  const clients = createClientRepo(ctx.db, ctx.clock, audit);
  const messages = createMessageRepo(ctx.db, ctx.clock, audit);
  const client = clients.create({ displayName: 'Test', timezone: 'UTC' });
  CTX = { clientId: client.id, batchId: messages.openBatch(client.id).id };
  llm = createFakeLlmClient();
  promptsDir = join(ctx.dir, 'prompts');
  mkdirSync(promptsDir);
  writeFileSync(join(promptsDir, 'router.md'), 'route messages\n');
  writeFileSync(join(promptsDir, 'gm_classifier.md'), 'judge GM validity\n');
  writeFileSync(join(promptsDir, 'gm_classifier_examples.md'), '(no rulings yet)\n');
  prompts = createPromptStore({ promptsDir });
});
afterEach(() => ctx.cleanup());

describe('validators (Phase 3 contracts)', () => {
  it('rejects bad enum, out-of-range confidence, missing/mistyped fields', () => {
    const good = { primary_intent: 'gm_checkin', confidence: 0.9, needs_response: false, reasoning: 'ok' };
    expect(validateRouterResult(good).primaryIntent).toBe('gm_checkin');
    expect(() => validateRouterResult({ ...good, primary_intent: 'spam' })).toThrow(/primary_intent/);
    expect(() => validateRouterResult({ ...good, confidence: 1.5 })).toThrow(/confidence/);
    expect(() => validateRouterResult({ ...good, needs_response: 'yes' })).toThrow(/needs_response/);
    expect(() => validateRouterResult(null)).toThrow(/not an object/);

    expect(validateClassifierResult({ is_valid_gm: true, reasoning: 'r' }).isValidGm).toBe(true);
    expect(() => validateClassifierResult({ is_valid_gm: 'yes', reasoning: 'r' })).toThrow(/is_valid_gm/);
    expect(() => validateClassifierResult({ is_valid_gm: true })).toThrow(/reasoning/);
  });
});

describe('router agent', () => {
  it('logs success to llm_calls with hash, tokens, latency', async () => {
    llm.enqueue('classify_batch', {
      primary_intent: 'coaching_question',
      confidence: 0.85,
      needs_response: true,
      reasoning: 'asks about food',
    });
    const router = createRouter({ llm, prompts, audit, model: 'test-model' });
    const result = await router.run('can I swap rice?', CTX);
    expect(result.needsResponse).toBe(true);

    const calls = audit.listLlmCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.agent).toBe('router');
    expect(calls[0]!.promptFileHash).toMatch(/^[0-9a-f]{40,64}$/);
    expect(calls[0]!.inputTokens).toBe(100);
    expect(calls[0]!.error).toBeUndefined();
  });

  it('malformed tool input takes the error path and is logged', async () => {
    llm.enqueue('classify_batch', { primary_intent: 'nonsense', confidence: 2 });
    const router = createRouter({ llm, prompts, audit, model: 'test-model' });
    await expect(router.run('hi', CTX)).rejects.toThrow(/primary_intent/);
    expect(audit.listLlmCalls()[0]!.error).toMatch(/primary_intent/);
  });
});

describe('classifier assembly', () => {
  it('system prompt contains both files; hash changes when examples change', async () => {
    llm.enqueue('classify_gm', { is_valid_gm: true, reasoning: 'clear GM' });
    const classifier = createGmClassifier({ llm, prompts, audit, model: 'test-model' });
    await classifier.run('GM', CTX);

    const req = llm.requests[0]!;
    expect(req.system).toContain('judge GM validity');
    expect(req.system).toContain('(no rulings yet)');

    const hashBefore = audit.listLlmCalls()[0]!.promptFileHash!;
    writeFileSync(join(promptsDir, 'gm_classifier_examples.md'), 'Message: "gm fam" → valid\n');
    llm.enqueue('classify_gm', { is_valid_gm: true, reasoning: 'clear GM' });
    await classifier.run('GM', CTX);
    const hashAfter = audit.listLlmCalls()[0]!.promptFileHash!; // newest first
    expect(hashAfter).not.toBe(hashBefore);
  });

  it('missing prompt file throws a clear error', () => {
    const broken = createPromptStore({ promptsDir: join(ctx.dir, 'nope') });
    const classifier = createGmClassifier({ llm, prompts: broken, audit, model: 'm' });
    // assembly happens inside run(); the error names the file
    return expect(classifier.run('GM', CTX)).rejects.toThrow(/Prompt file not found/);
  });
});
