# Stage 4 — Classification

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 4
**Goal:** Pending batches get processed: router + GM classifier run in parallel (D23), compliance moves on real messages, every LLM call lands in the audit log with its prompt hash. Ends with the accountability loop alive end-to-end: "GM" on Telegram → streak increments.

---

## Design Notes

- **One `LlmClient` interface, two implementations.** `AnthropicLlmClient` (the `@anthropic-ai/sdk`, forced tool-call via `tool_choice`) and `FakeLlmClient` (scripted responses + recorded calls) — the fake is the test default; nothing in CI touches the network (P4-4). The client returns parsed tool input + usage + latency; it never interprets results.
- **Tool-input validation is ours, not the SDK's.** The model's tool input is checked field-by-field against the Phase 3 schemas (enum membership, confidence range, required fields); a malformed response takes the same path as an API error. No schema library — two small validators.
- **Processor semantics (pipeline/process.ts), per D9/D23:**
  1. Load the batch's messages (oldest-first, joined as the batch text).
  2. **Compliance short-circuit (D9):** if today (client tz) is already `compliant`, the classifier is skipped — a DB read is the only gate.
  3. **Parallel calls:** router always; classifier unless short-circuited.
  4. Router success → `markBatchProcessed(intent, confidence, needsResponse)`. **Router failure → the batch stays `pending`** and is retried by the tick (below); a batch is never lost, never mislabeled.
  5. Classifier `is_valid_gm=true` → `engine.recordValidGm(clientId, lastMessageId)`; `false` → nothing (day stays unknown). **Classifier error (API or malformed output) → `engine.recordClassificationFailure` → pending review** — the conservative direction (D23).
  6. Every call — success or failure — is an `llm_calls` row: agent, model, prompt file hash(es), tokens, latency, result/error.
- **Retry is just re-processing:** the periodic tick picks up `pending` batches older than a small grace period and re-runs them. Idempotent by construction — `markBatchProcessed` requires `pending`, `recordValidGm` no-ops on a compliant day, `recordClassificationFailure` no-ops on an already-pending day.
- **Prompt assembly** (`agents/prompts.ts`): router = `router.md`; classifier = `gm_classifier.md` + `gm_classifier_examples.md` (few-shots appended). Read fresh per invocation via `PromptStore` (hot-read, D15); all blob hashes recorded (joined for multi-file assemblies).
- **All seven knowledge files are seeded now** from the Phase 3 templates — including the coach files and `autonomy.yaml` that Stage 5 consumes — so the knowledge plane exists as a whole from this point.
- **Models from config:** `ROUTER_MODEL` / `CLASSIFIER_MODEL`, both defaulting to Haiku 4.5. Exact model IDs confirmed against current API docs at build time.
- **Verify needs `ANTHROPIC_API_KEY`** in `v2/.env`. Dev-run cost is real from here but Haiku-scale (fractions of a cent per message); tests remain free.

## File List

```
v2/prompts/router.md                  # seeded from Phase 3 §2.1
v2/prompts/gm_classifier.md           # seeded from Phase 3 §2.2
v2/prompts/gm_classifier_examples.md  # reasoning-memory successor (starts empty of rulings)
v2/prompts/coach_system.md            # seeded from Phase 3 §2.3 (consumed Stage 5)
v2/prompts/coach_persona.md           #   "
v2/prompts/coach_examples.md          #   "
v2/prompts/autonomy.yaml              # all four response types at level 0
v2/src/agents/llmClient.ts            # LlmClient interface + Anthropic + Fake impls
v2/src/agents/prompts.ts              # assembly + hash capture
v2/src/agents/router.ts               # runRouter(batchText) → validated RouterResult
v2/src/agents/gmClassifier.ts         # runClassifier(batchText) → validated ClassifierResult
v2/src/pipeline/process.ts            # batch processor (short-circuit, parallel, wiring, retry query)
v2/src/app.ts                         # UPDATED: onBatchClosed → processor; tick retries pending
v2/src/cli/live-smoke.ts              # on-demand real-API smoke (2 sample batches)
v2/test/agents.test.ts                # validators + prompt assembly
v2/test/process.test.ts               # contract tests on FakeLlmClient
```

New dependency: `@anthropic-ai/sdk`. Config additions: `ROUTER_MODEL`, `CLASSIFIER_MODEL`.

## Key Interfaces

```ts
// agents/llmClient.ts
interface LlmToolRequest {
  model: string;
  system: string;
  userText: string;
  tool: { name: string; description: string; inputSchema: object };
  maxTokens?: number;
}
interface LlmToolResult {
  input: unknown;                 // the tool call's arguments (unvalidated)
  inputTokens: number; outputTokens: number; latencyMs: number;
}
interface LlmClient { completeWithTool(req: LlmToolRequest): Promise<LlmToolResult>; }

// agents/router.ts / gmClassifier.ts — each: assemble prompt → call → validate → log
interface RouterResult { primaryIntent: Intent; confidence: number; needsResponse: boolean; reasoning: string; }
interface ClassifierResult { isValidGm: boolean; reasoning: string; }

// pipeline/process.ts
interface Processor {
  processBatch(batchId: string): Promise<void>;   // full semantics above
  retryPending(): Promise<number>;                // pending batches past grace period
}
```

## Tasks

- [x] **1. LlmClient** — Anthropic implementation (forced tool-call) + Fake (scripted **per-tool-name** queues so parallel calls can't race, records every request) + `createUnconfiguredLlmClient` (boots without a key, fails loudly per call); model config.
  *AC: fake drives all contract tests; Anthropic impl typechecks and is exercised only by live-smoke.* ✅
- [x] **2. Knowledge files + prompt assembly** — all seven files seeded from Phase 3; classifier assembly = principles + examples with joined hashes. *(Assembly lives inside each agent rather than a separate prompts.ts — two call sites didn't justify a module.)*
  *AC: assembly test — classifier system prompt contains both files' content, hash changes when the examples file changes; missing file → clear error.* ✅
- [x] **3. Agents** — router + classifier: assemble → call → validate → audit-log (success and failure paths).
  *AC: validator tests — enum/range/required-field violations all rejected; malformed input takes the error path; llm_calls rows carry hashes, tokens, latency.* ✅ *(Test-writing found the FKs doing their job: llm_calls rejects fabricated client/batch ids.)*
- [x] **4. Processor** — short-circuit, parallel execution, compliance wiring, retry.
  *AC: all six contract cases green + malformed-router-output case.* ✅ 7 tests *(Interface additions: `ComplianceRepo.recordClassification`/`listClassifications` — the classifications table's writer — and `MessageRepo.listByBatch`/`listStalePendingBatches`.)*
- [x] **5. App wiring + live smoke** — `onBatchClosed` → processor; boot + tick call `retryPending()`; `live-smoke.ts` with cost estimate.
  *AC: wiring in place (fake-LLM app path exercised via processor tests); smoke run is manual, at Verify.* ✅

**Operator-found gap during Verify (2026-07-07):** "no streak increment" — diagnosis from the DB: (a) the test ran against an `npm start` process launched before Stage 4 existed (tsx doesn't hot-reload; batches sat `pending` under the Stage 3 stub), and (b) a real design gap — a running app read the dev-clock sidecar only at boot, so CLI `advance-day` in a second terminal silently didn't apply. Fix: the clock now re-reads the sidecar on an mtime check per read (dev mode only). +1 test.

**Stage complete:** 90 tests green (13 new), typecheck clean. Awaiting operator Verify checkpoint (needs `ANTHROPIC_API_KEY`).

## Verify (operator checkpoint)

1. Add `ANTHROPIC_API_KEY` to `v2/.env`; optionally run `npx tsx src/cli/live-smoke.ts` first — it exercises both agents standalone and prints what they returned.
2. `npm start`, then from Telegram (as your verified test client): send **"GM"** → after the debounce window, the log shows classification and `npm run clients -- list` shows **streak=1**. The accountability loop is alive.
3. Send **"GM! also can I swap rice for sweet potato?"** the next (simulated) day → streak=2 AND the batch lands as `coaching_question` / needs_response=1 — the D23 both-paths case, visible in the DB (`batches`, `classifications`, `llm_calls` with prompt hashes).
4. `npm test` stays green (77 + this stage's suites) — none of it needed the network.
