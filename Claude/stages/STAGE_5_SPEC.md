# Stage 5 — Response Path

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 5
**Goal:** The coach agent drafts replies through a bounded tool loop; drafts live in the approval queue with DB-enforced invariants; the send path delivers through the adapter under the send-time freshness check. Ends with: trigger → draft → edit → send → message lands in Telegram, fully audited.

---

## Design Notes

- **`LlmClient` grows a second method: `converse()`.** The coach isn't a forced single tool call — it's a multi-turn loop with four tools and `tool_choice: auto` (forced to `draft_response` on the final permitted turn, P3-4). `converse` returns the assistant's content blocks (text + tool_use) and usage; the loop lives in `coach.ts`, not the client. The fake gains a scripted-turns queue and records each request's `toolChoice` — that's how tests prove the max-turns force.
- **ContextBuilder (Phase 2 §4), pushed once at loop start:** the narrative file whole (or an explicit "(no narrative on file)"), a computed compliance block (current streak, last-7-day pattern, today), and the recent conversation verbatim (last `CONTEXT_MAX_MESSAGES`/`CONTEXT_MAX_DAYS`, oldest-first, timestamped, direction-labeled) with the **unanswered span marked** — everything after the last outbound.
- **Tool handlers are deterministic code** (Phase 3's category table): `get_recent_conversation` / `get_compliance_summary` are repository reads returning text; `flag_for_narrative` writes a flag (the staleness feed) and acks; `draft_response` validates (`response_type` enum, confidence range), creates the draft row, and terminates the loop. A model-invented `response_type` fails the draft — the operator re-triggers; nothing fails silently.
- **Draft trigger is a guarded service, not a raw agent call:** `triggerDraft(clientId)` requires an active client, refuses when an active draft already exists (the DB backstops via P2-6 anyway), computes `covers_through_message_id` = newest inbound, runs the coach, returns the draft.
- **Send order: deliver, then record.** `send(draftId, finalText)` → freshness check (D19; stale → mark stale + typed error, nothing sent) → `adapter.send` → transaction: `markSent(finalText)` + append the outbound message row (linked to the draft). Trade-off stated plainly: if the process dies *between* delivery and recording, a retry could double-send — but the operator is present at Level 0 and sees the failure; the reverse order (record-then-send) would instead mark unsent messages as sent, which corrupts the audit trail silently. Deliver-then-record fails loud, never lies.
- **Autonomy policy wiring (fail closed):** `autonomy.yaml` is parsed per action (hot-read, D15); unknown or missing response types resolve to Level 0. At Level 0 the policy changes nothing operationally — this is the seam the ladder opens through later, built now so the send path always consults it. New dependency: `yaml`.
- **Dev CLI until the Stage 6 UI exists:** `npm run drafts -- trigger <clientId> | show <clientId> | send <draftId> [--text "..."] | reject <draftId>`. The Verify runbook drives it.
- **Config additions:** `COACH_MODEL` (default `claude-sonnet-5` — the current Sonnet, per the Phase 3 model table). `ClientRepo` gains `getIdentity(clientId, channel)` for the outbound adapter lookup.

## File List

```
v2/src/agents/llmClient.ts     # UPDATED: + converse() on both implementations + fake
v2/src/agents/coach.ts         # bounded loop, 4 tool handlers, audit per turn
v2/src/pipeline/context.ts     # ContextBuilder
v2/src/approval/autonomy.ts    # policy load, fail-closed
v2/src/approval/drafts.ts      # DraftService: triggerDraft / send / reject
v2/src/cli/drafts.ts           # dev trigger surface (npm run drafts)
v2/src/app.ts                  # UPDATED: coach + draft service wiring
v2/test/coach.test.ts
v2/test/drafts.test.ts
```

## Key Interfaces

```ts
// llmClient.ts additions
interface LlmMessage { role: 'user' | 'assistant'; content: string | LlmContentBlock[]; }
type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string };
interface LlmConverseRequest {
  model: string; system: string; messages: LlmMessage[];
  tools: Array<{ name: string; description: string; inputSchema: object }>;
  toolChoice?: { type: 'auto' } | { type: 'tool'; name: string };
  maxTokens?: number;
}
interface LlmConverseResult { content: LlmContentBlock[]; inputTokens: number; outputTokens: number; latencyMs: number; }

// agents/coach.ts
interface Coach { draft(clientId: string): Promise<Draft>; }  // throws on failure; never silent

// approval/drafts.ts
class StaleDraftError extends Error {}
interface DraftService {
  triggerDraft(clientId: string): Promise<Draft>;
  send(draftId: string, finalText?: string): Promise<void>;   // finalText omitted = send as drafted
  reject(draftId: string): void;
}

// approval/autonomy.ts
interface AutonomyPolicy { levelFor(responseType: string): { level: 0 | 1 | 2; autoSendMinConfidence?: number }; }
```

## Tasks

- [x] **1. `converse()` on LlmClient** — Anthropic implementation (tools + tool_choice + content-block mapping) and fake (scripted turn queue, records `toolChoice`).
  *AC: fake drives all coach tests; typecheck on the Anthropic path.* ✅ *(Bug found by tests: the fake recorded a reference to the caller's mutating message array — it now snapshots per call.)*
- [x] **2. ContextBuilder** — narrative + compliance block + windowed conversation with unanswered-span marker.
  *AC: tests — window respects both limits; span marker sits after the last outbound; missing narrative states so explicitly.* ✅ 5 tests
- [x] **3. Coach loop** — context push, four tool handlers, bounded turns, final-turn force, per-turn audit rows with joined coach prompt hashes.
  *AC: all five cases green + refuses an empty conversation.* ✅ 6 tests *(Text-only turns get a nudge message and count toward the cap; the coach stamps `autonomyLevel` from the policy at draft creation.)*
- [x] **4. DraftService + autonomy policy** — guarded trigger, deliver-then-record send with freshness check, reject; YAML policy with fail-closed default.
  *AC: all cases green, plus refuse-resend-of-resolved-draft.* ✅ 6 tests
- [x] **5. App wiring + drafts CLI** — coach/draft service in `buildApp`; CLI trigger/show/send/reject (+ per-draft LLM stats).
  *AC: CLI boots against the dev DB; existing app tests stay green.* ✅ *(Interface addition: `ClientRepo.getIdentity` for the outbound adapter lookup.)*

**Stage complete:** 108 tests green (18 new), typecheck clean. Awaiting operator Verify checkpoint (needs `ANTHROPIC_API_KEY` + `TELEGRAM_TOKEN`).

## Verify (operator checkpoint)

**Restart `npm start` first — new code doesn't hot-reload.**

1. From Telegram, send a real question ("can I train fasted?"). After the debounce, the batch shows `needs_response=1`.
2. `npm run drafts -- trigger <your-client-id>` → the coach drafts in your voice (persona + calibration examples are live); `npm run drafts -- show <id>` displays it with confidence + note.
3. Send it edited: `npm run drafts -- send <draftId> --text "your edited version"` → **the message arrives in your Telegram**; `drafts` table shows `sent` with your `final_text`; the audit event records `edited: true`.
4. The freshness invariant, live: trigger a draft, then send yourself another Telegram message *before* sending the draft → the send refuses with a stale error; the draft is marked stale.
5. `npm test` green throughout (90 + this stage's suites — still nothing in CI touches the network).
