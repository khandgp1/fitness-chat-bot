# Stage 9 — Operator ↔ Coach Discussion Mode ("coach chat")

**Status:** Spec presented for operator review — NOT yet implemented
**Roadmap:** post-Phase-5 addition (no existing stage covers this)
**Goal:** The operator can converse with the runtime coach agent about a specific client's reply — the agent aware it is talking to the operator, not the client — iterating together until a draft is right. New decision recorded as **D24**.

---

## D24 — Operator-mode contract (new decision)

No existing decision (D1–D23, P2-*, P3-*, P4-*) covers operator↔runtime-coach conversation; the phase docs' "operator converses with an agent" is the design-plane meta-agent (D13), a different thing. D24:

- **Same agent, new entry point.** The runtime coach (`v2/src/agents/coach.ts`, Anthropic API, tuned prompt files, D8 single voice) gains a `discuss()` path alongside `draft()`. Not a CLI-skill agent.
- **Free-form discussion.** Plain-text replies are the normal terminal state; `draft_response` is called only when the operator asks for/agrees on a draft — **never forced**. P3-4 ("must end in draft_response") is hereby scoped to the Level-0 `triggerDraft` path only.
- **Ephemeral thread.** The conversation lives in admin-UI React state, replayed whole to a stateless endpoint each turn. No new table; no chat audit trail (operator decision). Standard `llm_calls` logging stays (agent `'coach'`) for cost/error visibility in `/api/health`.
- **Supersede policy.** A draft produced mid-discussion auto-rejects any existing active draft (old text retained as `rejected` — calibration signal per D19 — and audited via the existing `markRejected`). Rationale: the operator is actively working this reply; a 409+confirm flow would waste the completed LLM turn and add state.
- **Turn-cap grace.** If the tool-loop budget (`maxTurns`) is exhausted mid-discussion, return a graceful plain-text reply plus a `coach_discuss_turn_cap` audit event — never throw, never force a draft.

## Design Notes

- **Prompt (`v2/prompts/coach_operator.md`, new):** appended as a 4th file after `coach_system.md` + `coach_persona.md` + `coach_examples.md` in discuss mode only (persona/examples stay in force; this file's rules win by being last and explicit). Must state: you are talking to the OPERATOR, the client cannot see this; plain-text analysis/options/trade-offs are the norm, coach-to-coach voice allowed; overrides base rule 4 — call `draft_response` only when asked; a draft is still addressed to the CLIENT in the usual coach voice under all base drafting rules; read tools and `flag_for_narrative` work as usual.
- **Coach (`v2/src/agents/coach.ts`):**
  ```ts
  export interface DiscussTurn { role: 'operator' | 'coach'; text: string }
  export type DiscussResult =
    | { kind: 'reply'; text: string }
    | { kind: 'draft'; draft: Draft; text: string }; // text = accompanying commentary, may be ''
  export interface Coach {
    draft(clientId: string): Promise<Draft>;
    discuss(clientId: string, thread: DiscussTurn[]): Promise<DiscussResult>;
  }
  ```
  - `assembleSystem(mode: 'draft' | 'discuss')` — discuss appends `coach_operator.md`; gitHash joins 4 hashes. `draft()` path untouched.
  - Thread validation: non-empty; valid roles + non-empty text; first and last turns `'operator'`.
  - Message splicing — context (`deps.context.build(clientId)`, rebuilt fresh every call) merged into the first operator turn to avoid consecutive same-role messages:
    ```ts
    const messages: LlmMessage[] = [
      { role: 'user', content: `${context}\n\n=== OPERATOR DISCUSSION ===\n${thread[0].text}` },
      ...thread.slice(1).map((t) => ({ role: t.role === 'operator' ? 'user' : 'assistant', content: t.text })),
    ];
    ```
  - Tool loop: same shape as `draft()`'s, reusing `TOOLS`, `runReadTool`, `validateDraftArgs`, and the per-turn `audit.llmCall` pattern verbatim — but `toolChoice` always `{ type: 'auto' }`. Terminal conditions per turn: `draft_response` → validate → supersede check → `drafts.create` (as in `draft()`; `coversThroughMessageId` from `latestInbound`, resolved lazily — "nothing to reply to" only if a draft is attempted with no inbound; pure discussion of a no-inbound client stays legal) → `{ kind: 'draft', ... }`. Read tools / flag → run handlers, continue. Text only → `{ kind: 'reply', text }`. Cap exceeded → turn-cap grace (D24).
- **Service (`v2/src/approval/drafts.ts`):** `DraftService.discuss(clientId, thread)` — same client-exists + active-status guard as `triggerDraft`, minus the no-active-draft check (supersede replaces it), then delegate to `coach.discuss`. No `app.ts` wiring changes.
- **API (`v2/src/server/api.ts`):** `POST /api/clients/:id/discuss`, thin glue: body `{ thread: DiscussTurn[] }`, validate shape + 1–100 turn bound (cost bound on stateless replay), respond with the `DiscussResult` verbatim; deeper validation surfaces as 400 via `h()`.
- **UI (`v2/admin-ui/src/views/ClientDetail.tsx` + `api.ts` types):** "Discuss with coach" section between Drafts and Narrative. Local state `chat` / `chatInput` / `chatBusy` (dedicated busy, draft panel stays usable; resets on navigation — accepted). Send: optimistic append → POST → `reply` appends a coach bubble; `draft` appends "(drafted a reply — see Drafts panel above)" + `refresh()` so the active draft appears in the existing panel (existing Send/Reject; **no new send path**). Error: `reportError`, pop optimistic turn, restore input. Bubbles reuse `msg outbound` (operator) / `msg inbound` (coach); "coach is thinking…" while busy; Enter-to-send; ghost Clear button.

## File List

```
v2/prompts/coach_operator.md          # NEW: operator-mode framing
v2/src/agents/coach.ts                # UPDATED: DiscussTurn/DiscussResult, assembleSystem(mode), discuss()
v2/src/approval/drafts.ts             # UPDATED: DraftService.discuss
v2/src/server/api.ts                  # UPDATED: POST /api/clients/:id/discuss
v2/admin-ui/src/api.ts                # UPDATED: DiscussTurn/DiscussResult mirrors
v2/admin-ui/src/views/ClientDetail.tsx# UPDATED: chat panel
v2/test/coach.test.ts                 # UPDATED: discuss unit tests
v2/test/api.test.ts                   # UPDATED: discuss HTTP tests
```

## Tasks

- [ ] **1. Prompt** — `coach_operator.md` per Design Notes.
- [ ] **2. Coach `discuss()`** — types, `assembleSystem(mode)`, loop with auto toolChoice, supersede, turn-cap grace.
  *AC (unit, FakeLlmClient.enqueueTurn):* text-only turn → `{kind:'reply'}`, no draft, system contains operator file, toolChoice auto, context+first turn merged; read-tool turn then text → reply with tool_result threaded; text+draft turn → `{kind:'draft'}` with correct `coversThroughMessageId`/`autonomyLevel`, commentary preserved; supersede: pre-existing active draft → old `rejected` (audited), new active; cap: `maxTurns` read-tool turns → graceful reply, no forced toolChoice, `coach_discuss_turn_cap` audited; validation: empty thread / last-turn-coach reject; 3-turn thread maps to roles `[user, assistant, user]`.
- [ ] **3. Service + route** — `DraftService.discuss`; `POST /api/clients/:id/discuss`.
  *AC (HTTP, api.test.ts harness):* discuss → 200 `{kind:'reply'}` + `llm_calls` row agent `'coach'`; DRAFT_TURN → 200 `{kind:'draft'}`, draft visible in `GET /api/clients/:id`, existing `POST /api/drafts/:id/send` delivers via fake adapter; discuss-draft over active draft → 200, old `rejected`; bad bodies → 400; non-active client → 400.
- [ ] **4. UI panel** — per Design Notes; rebuild `admin-ui`.
- [ ] **5. Suite green + typecheck clean.**

## Verify

`npm test` + `npx tsc --noEmit` green (no network — FakeLlmClient). End-to-end with the server running and a real API key: open ClientDetail, ask the coach a question (plain-text reply appears; call logged in `/api/llm-calls`), continue the thread, then say "draft it" — the draft appears in the Drafts panel and sends via the existing button. Confirm `triggerDraft` behavior unchanged (existing tests stay green).
