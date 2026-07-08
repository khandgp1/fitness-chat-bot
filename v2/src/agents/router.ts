import type { AuditRepo } from '../repos/auditRepo.js';
import type { PromptStore } from '../repos/promptStore.js';
import type { Intent } from '../repos/types.js';
import type { LlmClient } from './llmClient.js';

/**
 * Response shaping only (D23): primary_intent + needs_response.
 * Never a compliance input. Runs in parallel with the GM classifier.
 */
export interface RouterResult {
  primaryIntent: Intent;
  confidence: number;
  needsResponse: boolean;
  reasoning: string;
}

export interface Router {
  run(batchText: string, ctx: { clientId: string; batchId: string }): Promise<RouterResult>;
}

const INTENTS: readonly Intent[] = ['gm_checkin', 'coaching_question', 'status_update', 'other'];

const CLASSIFY_BATCH_TOOL = {
  name: 'classify_batch',
  description: 'Classify what kind of reply, if any, this batch of client messages needs.',
  inputSchema: {
    type: 'object',
    properties: {
      primary_intent: { enum: [...INTENTS] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      needs_response: { type: 'boolean' },
      reasoning: { type: 'string', description: 'one sentence' },
    },
    required: ['primary_intent', 'confidence', 'needs_response', 'reasoning'],
  },
};

/** Field-by-field validation (Phase 3 §2.1); malformed = same path as an API error. */
export function validateRouterResult(input: unknown): RouterResult {
  if (typeof input !== 'object' || input === null) throw new Error('Router: input not an object');
  const r = input as Record<string, unknown>;
  if (!INTENTS.includes(r.primary_intent as Intent)) {
    throw new Error(`Router: invalid primary_intent '${String(r.primary_intent)}'`);
  }
  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    throw new Error(`Router: confidence out of range: ${String(r.confidence)}`);
  }
  if (typeof r.needs_response !== 'boolean') throw new Error('Router: needs_response not boolean');
  if (typeof r.reasoning !== 'string') throw new Error('Router: reasoning not a string');
  return {
    primaryIntent: r.primary_intent as Intent,
    confidence: r.confidence,
    needsResponse: r.needs_response,
    reasoning: r.reasoning,
  };
}

export function createRouter(deps: {
  llm: LlmClient;
  prompts: PromptStore;
  audit: AuditRepo;
  model: string;
}): Router {
  return {
    async run(batchText, ctx) {
      const { content, gitHash } = deps.prompts.get('router.md'); // hot-read (D15)
      const started = Date.now();
      try {
        const raw = await deps.llm.completeWithTool({
          model: deps.model,
          system: content,
          userText: batchText,
          tool: CLASSIFY_BATCH_TOOL,
          maxTokens: 256,
        });
        const result = validateRouterResult(raw.input);
        deps.audit.llmCall({
          clientId: ctx.clientId,
          batchId: ctx.batchId,
          agent: 'router',
          model: deps.model,
          promptFileHash: gitHash,
          inputTokens: raw.inputTokens,
          outputTokens: raw.outputTokens,
          latencyMs: raw.latencyMs,
          result,
        });
        return result;
      } catch (err) {
        deps.audit.llmCall({
          clientId: ctx.clientId,
          batchId: ctx.batchId,
          agent: 'router',
          model: deps.model,
          promptFileHash: gitHash,
          latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  };
}
