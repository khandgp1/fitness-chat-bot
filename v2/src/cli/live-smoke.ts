/**
 * On-demand real-API smoke test (never in CI, P4-4). Runs the router and
 * GM classifier against live Haiku on two samples and prints results.
 * Run: npx tsx src/cli/live-smoke.ts   (needs ANTHROPIC_API_KEY in .env)
 */
import 'dotenv/config';
import { createGmClassifier } from '../agents/gmClassifier.js';
import { createAnthropicLlmClient } from '../agents/llmClient.js';
import { createRouter } from '../agents/router.js';
import { loadConfig } from '../config/config.js';
import type { AuditRepo } from '../repos/auditRepo.js';
import { createPromptStore } from '../repos/promptStore.js';
import type { LlmCallInput } from '../repos/types.js';

const cfg = loadConfig();
if (cfg.anthropicApiKey === undefined) {
  console.error('ANTHROPIC_API_KEY is not set in v2/.env');
  process.exit(1);
}

// Print-only audit sink — the smoke test has no DB.
const calls: LlmCallInput[] = [];
const audit = {
  event: () => undefined,
  llmCall: (c: LlmCallInput) => void calls.push(c),
  listEvents: () => [],
  listLlmCalls: () => [],
} as AuditRepo;

const llm = createAnthropicLlmClient({ apiKey: cfg.anthropicApiKey });
const prompts = createPromptStore({ promptsDir: cfg.promptsDir });
const router = createRouter({ llm, prompts, audit, model: cfg.routerModel });
const classifier = createGmClassifier({ llm, prompts, audit, model: cfg.classifierModel });

const SAMPLES = ['GM', 'GM! also — can I swap white rice for sweet potato?'];
const ctx = { clientId: 'smoke', batchId: 'smoke' };

for (const sample of SAMPLES) {
  console.log(`\n=== "${sample}"`);
  const [r, c] = await Promise.all([router.run(sample, ctx), classifier.run(sample, ctx)]);
  console.log(`router:     ${r.primaryIntent} (conf ${r.confidence}) needs_response=${r.needsResponse}`);
  console.log(`            ${r.reasoning}`);
  console.log(`classifier: is_valid_gm=${c.isValidGm} — ${c.reasoning}`);
}

const inTok = calls.reduce((s, c) => s + (c.inputTokens ?? 0), 0);
const outTok = calls.reduce((s, c) => s + (c.outputTokens ?? 0), 0);
// Haiku 4.5: $1/M input, $5/M output
const cost = (inTok / 1e6) * 1 + (outTok / 1e6) * 5;
console.log(`\n${calls.length} calls · ${inTok} in / ${outTok} out tokens · ~$${cost.toFixed(5)}`);
