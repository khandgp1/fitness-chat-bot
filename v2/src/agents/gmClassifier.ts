import type { AuditRepo } from '../repos/auditRepo.js';
import type { PromptStore } from '../repos/promptStore.js';
import type { LlmClient } from './llmClient.js';

/**
 * Sole authority on the compliance question (D23). Runs on every batch until
 * the day is Compliant — the D9 short-circuit (a DB read in the processor)
 * is its only gate. Errors resolve to pending review upstream.
 */
export interface ClassifierResult {
  isValidGm: boolean;
  reasoning: string;
}

export interface GmClassifier {
  run(batchText: string, ctx: { clientId: string; batchId: string }): Promise<ClassifierResult>;
}

const CLASSIFY_GM_TOOL = {
  name: 'classify_gm',
  description: 'Judge whether this batch contains a valid daily GM check-in.',
  inputSchema: {
    type: 'object',
    properties: {
      is_valid_gm: { type: 'boolean' },
      reasoning: { type: 'string', description: 'one sentence' },
    },
    required: ['is_valid_gm', 'reasoning'],
  },
};

export function validateClassifierResult(input: unknown): ClassifierResult {
  if (typeof input !== 'object' || input === null) throw new Error('Classifier: input not an object');
  const r = input as Record<string, unknown>;
  if (typeof r.is_valid_gm !== 'boolean') throw new Error('Classifier: is_valid_gm not boolean');
  if (typeof r.reasoning !== 'string') throw new Error('Classifier: reasoning not a string');
  return { isValidGm: r.is_valid_gm, reasoning: r.reasoning };
}

export function createGmClassifier(deps: {
  llm: LlmClient;
  prompts: PromptStore;
  audit: AuditRepo;
  model: string;
}): GmClassifier {
  return {
    async run(batchText, ctx) {
      // Assembly (Phase 3 §1): principles + reasoning-memory few-shots, hot-read.
      const principles = deps.prompts.get('gm_classifier.md');
      const examples = deps.prompts.get('gm_classifier_examples.md');
      const system = `${principles.content}\n\n${examples.content}`;
      const gitHash = `${principles.gitHash}+${examples.gitHash}`;
      const started = Date.now();
      try {
        const raw = await deps.llm.completeWithTool({
          model: deps.model,
          system,
          userText: batchText,
          tool: CLASSIFY_GM_TOOL,
          maxTokens: 256,
        });
        const result = validateClassifierResult(raw.input);
        deps.audit.llmCall({
          clientId: ctx.clientId,
          batchId: ctx.batchId,
          agent: 'gm_classifier',
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
          agent: 'gm_classifier',
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
