# Phase 3 — Agent Framework Specification

**Status:** ✅ APPROVED by operator — 2026-07-07
**Date:** 2026-07-07
**Depends on:** `PHASE_1_ARCHITECTURE.md` (D1–D23), `PHASE_2_DATA_MODEL.md` (P2-1–P2-8) — both approved
**Scope:** Runtime agent prompts and tool schemas, routing logic, response taxonomy, autonomy-ladder policy, miss handling, triage item model, and design-plane workflow specs. Build order and testing are Phase 4.

**A note on the prompt templates herein:** they are **v1 starting points, not final copy**. The design plane exists precisely to tune them against evidence (D13–D15); expect every prompt file to drift from this document, with git as the record. What this document fixes is the *contracts* — output schemas, tool interfaces, invariants — which prompts may not violate.

---

## 1. Prompt Architecture

Every runtime agent's system prompt is assembled at invocation time from prompt files + computed context — never hardcoded:

| Agent | Assembly |
|---|---|
| Router | `prompts/router.md` |
| GM Classifier | `prompts/gm_classifier.md` + `prompts/gm_classifier_examples.md` |
| Coach | `prompts/coach_system.md` + `prompts/coach_persona.md` + `prompts/coach_examples.md` + narrative file + compliance block + recent conversation (Phase 2 §4) |

Every `llm_calls` row records the git blob hash of each file in the assembly. Files are read fresh per invocation (hot-read, D15/D16).

---

## 2. Runtime Agent Specs

### 2.1 Router

**Model:** Haiku · **Invocation:** once per processed batch, in parallel with the GM classifier (D23) · **Output:** forced tool-call.

**Tool schema:**

```json
{
  "name": "classify_batch",
  "input_schema": {
    "type": "object",
    "properties": {
      "primary_intent": { "enum": ["gm_checkin", "coaching_question", "status_update", "other"] },
      "confidence":     { "type": "number", "minimum": 0, "maximum": 1 },
      "needs_response": { "type": "boolean" },
      "reasoning":      { "type": "string", "description": "one sentence" }
    },
    "required": ["primary_intent", "confidence", "needs_response", "reasoning"]
  }
}
```

**`prompts/router.md` (v1 template):**

```markdown
You route incoming messages for a fitness coaching service. You will see a batch
of one or more messages a client sent in a short window. Judge the batch as a whole.

You answer exactly one question: what kind of reply, if any, would a coach's
response to this batch be? You do NOT judge whether the client checked in —
that is another system's job, and your output never affects compliance tracking.

primary_intent — what a reply would be responding to:
- gm_checkin: the batch is only a morning check-in (GM, good morning, etc.),
  nothing else of substance
- coaching_question: the client asks for guidance, permission, or a decision
  (food swaps, training changes, "should I...")
- status_update: the client reports something — a workout done, a meal, a slip,
  how they're feeling
- other: none of the above (small talk, acknowledgments, unclear)

If the batch mixes a check-in with substance ("GM — also, can I swap rice for
sweet potato?"), the substance wins: primary_intent reflects the part deserving
a reply.

needs_response — would a good coach reply to this? A bare check-in usually
needs none. A question always does. A status update usually deserves brief
reinforcement. WHEN UNCERTAIN, ANSWER TRUE — an unnecessary queue item is
cheap; a client question left hanging is not.

confidence — your honest certainty in primary_intent, 0 to 1.
```

**Calibration loop:** triage-queue dismissals of awaiting-response items ("no reply needed") are logged to `audit_events` — the false-positive record `/tune-prompts` reads.

### 2.2 GM Classifier

**Model:** Haiku · **Invocation:** every batch until the client's day is Compliant (D9 is the sole gate; D23) · **Output:** forced tool-call. Sole authority on the compliance question.

**Tool schema:**

```json
{
  "name": "classify_gm",
  "input_schema": {
    "type": "object",
    "properties": {
      "is_valid_gm": { "type": "boolean" },
      "reasoning":   { "type": "string", "description": "one sentence" }
    },
    "required": ["is_valid_gm", "reasoning"]
  }
}
```

**`prompts/gm_classifier.md` (v1 template — principles preserved from prototype):**

```markdown
You judge whether a batch of client messages contains a valid daily "GM"
check-in for an accountability coaching service.

Principles, not rules:
- "GM", "good morning", and typo variants ("gm!", "gmm", "goodmorning") are valid.
- A bare "morning" alone generally falls short.
- The check-in can appear anywhere in the batch — a valid GM followed by a
  question is still a valid GM.
- A message that merely mentions mornings ("this morning I trained early")
  is not a check-in.
- Borderline cases: use your judgment; it is authoritative. Explain briefly.

Approved rulings from the operator follow. Where they apply, they override
your own inclination.
```

**`prompts/gm_classifier_examples.md`** — the reasoning-memory successor: operator-approved rulings appended via the design plane, each as `message → ruling → why`, injected verbatim after the principles.

**Error semantics:** an API/parse failure classifies nothing — the day goes to `pending_review` (hold, never reset), resolving naturally if a valid GM arrives later (state machine, Phase 2 §2.3).

### 2.3 Primary Coaching Agent

**Model:** Sonnet · **Invocation:** operator draft-trigger (autonomy Level 0, D21) on an awaiting-response or miss-follow-up item · **Flow:** bounded tool loop, max 6 turns, **must terminate by calling `draft_response`.**

**Pushed context** (ContextBuilder, Phase 2 §4): narrative file whole · compliance block (streak, 7-day pattern, today) · last 30 messages / 14 days verbatim. Tools exist to *pull* beyond this window.

**Tool schemas:**

```json
{ "name": "get_recent_conversation",
  "input_schema": { "type": "object", "properties": {
      "before_message_id": { "type": "string" },
      "limit": { "type": "integer", "maximum": 50 } } } }

{ "name": "get_compliance_summary",
  "input_schema": { "type": "object", "properties": {
      "days": { "type": "integer", "maximum": 90 } } } }

{ "name": "flag_for_narrative",
  "input_schema": { "type": "object", "properties": {
      "note": { "type": "string", "description": "durable fact or pattern worth adding to the client narrative" } },
    "required": ["note"] } }

{ "name": "draft_response",
  "input_schema": { "type": "object", "properties": {
      "text":          { "type": "string" },
      "response_type": { "enum": ["gm_ack", "status_ack", "coaching_answer", "accountability_followup"] },
      "confidence":    { "type": "number", "minimum": 0, "maximum": 1 },
      "note":          { "type": "string", "description": "agent→operator only; never sent to the client" } },
    "required": ["text", "response_type", "confidence"] } }
```

Deliberately absent: any send capability, any write besides `draft_response`/`flag_for_narrative`, any narrative mutation (Phase 1 principle 3).

**`prompts/coach_persona.md` (v1 — from the operator's production voice):**

```markdown
Voice:
- Direct and minimal. No fluff, no excessive pleasantries.
- Short, punchy, supportively objective. This is a text message.
- NO EMOJIS. Ever.
- 1–2 sentences maximum.
- A short follow-up question that moves the client forward is often the
  best reply.
```

**`prompts/coach_examples.md` (v1 — production calibration set):**

```markdown
Client: "Forgot my check-in this morning, sorry. Was rushing out."
Coach:  "No worries. What did you end up having for breakfast?"

Client: "Just finished the leg workout. Feeling super exhausted but got all reps done."
Coach:  "Awesome work pushing through. Make sure to get a high-protein meal in soon."

Client: "Can I swap the white rice for sweet potatoes in my meal plan?"
Coach:  "Yes, that is a direct 1-to-1 swap for your carb source. Just keep the portion size the same."

Client: "Stressed today and skipped the gym, then ate cookies."
Coach:  "One off-track day won't ruin your progress. Let's focus on hitting tomorrow's workout and meal plan."
```

**`prompts/coach_system.md` (v1 template — behavioral rules):**

```markdown
You draft replies for a men's physique coach. The coach reviews every draft
before sending; you never send anything yourself.

You will receive: the client's narrative (who they are, current focus, what
works with them), their compliance summary, and the recent conversation.
The unanswered span — everything since the coach's last reply — is marked.

Rules:
1. Answer the WHOLE unanswered span, not just the last message.
2. The narrative governs tone and content choices. "What Works / What Doesn't"
   is there for a reason.
3. Coaching philosophy: one focus at a time. Do not volunteer plans, programs,
   or extra advice beyond what was asked or what the moment needs.
4. Always produce a draft — the coach asked for one. If the situation deserves
   the coach's personal judgment (injury, life event, emotional weight),
   still draft your best attempt and say why in `note`.
5. Express uncertainty through the `confidence` field and `note` — never
   through hedged prose in the draft itself.
6. If you learn something durable about the client (schedule change, new
   obstacle, what landed well), call flag_for_narrative before drafting.
7. Use the tools to pull older history only when the pushed context is
   genuinely insufficient.
```

---

## 3. Subagent Delegation — Mechanism Reserved, Unused in v1

With narrative and assessment work in the design plane, v1 has **no runtime delegation**; router and classifier are pipeline stages, not delegates. The reserved mechanism, for future domains (D8 semantics):

- A subagent = prompt file + restricted tool set + JSON in/out contract, registered as a tool on the coach (e.g. `consult_nutrition(question) → {answer, rationale}`).
- Call/return only: subagents never draft, never send, never write.
- Every invocation logged to `llm_calls` with its own prompt hash.
- Adding a domain touches: one prompt file, one tool registration, new tables if the domain owns data (Phase 2 §8). Nothing else.

## 4. Response Types & Autonomy Policy

**Taxonomy (P3-1, operator-approved):**

| Type | Covers | Autonomy outlook |
|---|---|---|
| `gm_ack` | brief check-in acknowledgment | first to auto-open — most formulaic |
| `status_ack` | reinforcement of reported wins/struggles | later |
| `coaching_answer` | substantive guidance (nutrition, training) | last — highest stakes |
| `accountability_followup` | response to a miss or drift | likely never fully auto |

**Policy config** — `prompts/autonomy.yaml` (knowledge plane, git-audited, hot-read by the send path):

```yaml
autonomy:
  gm_ack:                  { level: 0, auto_send_min_confidence: null }
  status_ack:              { level: 0, auto_send_min_confidence: null }
  coaching_answer:         { level: 0, auto_send_min_confidence: null }
  accountability_followup: { level: 0, auto_send_min_confidence: null }
```

Levels per D21 (0 operator-triggered draft / 1 auto-draft / 2 auto-send above threshold). Opening the gate = editing this file in a design-plane session, one type at a time, evidence in hand. Enforcement lives in the send/draft paths, which read the file fresh per action; an unknown `response_type` fails closed to level 0.

## 5. Miss Handling (P3-2, operator-approved)

**The system never messages anyone automatically about a miss.** A missed day becomes something deserving the operator's attention rather than a silent log entry:

- When day reconciliation closes a day as `miss`, it sets `compliance_days.followup_state = 'pending'` (schema amendment, §8).
- The triage queue shows a **miss follow-up item**: client, date, streak lost, last exchange.
- The operator may: trigger a draft (`accountability_followup` — the coach agent receives the miss context), reply personally, or **dismiss** (`followup_state = 'dismissed'`).
- The item clears to `'handled'` when any outbound message is sent to the client while pending.
- Dismissals and handling are audit events — future evidence for whether/when miss responses deserve automation.

## 6. Unified Triage Item Model

Everything in the operator's queue, its source of truth, and how it clears:

| Item | Source | Clears when |
|---|---|---|
| Awaiting response | processed batch, `needs_response=1`, `dismissed_at` NULL, no covering non-stale sent/draft | covering draft sent, or dismissed (`batches.dismissed_at`, §8) |
| Pending draft | `drafts.status='draft'` | approved+sent / rejected / stale |
| Miss follow-up | `compliance_days.followup_state='pending'` | handled or dismissed (§5) |
| Pending review | `compliance_days.status='pending_review'`, day closed | operator ruling (audited compliance correction) or natural resolution |
| Narrative staleness | flags + reply-worthy batches since watermark ≥ threshold | watermark advance (design-plane session) |
| Unverified contact | `clients.status='pending_verification'` | verified or blocked |

All items are queries over existing state — the queue itself stores nothing (consistent with "derive, don't duplicate").

## 7. Design-Plane Workflows

**Shared shape:** command → pre-pulled context → conversation → file edits → git commit → bookkeeping. Read access via a small helper that opens SQLite **read-only** (writes impossible by construction); the only DB write any workflow performs is watermark/flag bookkeeping through a dedicated, audited helper.

**`/narrative-update <client>`** — pulls: narrative, history since watermark, uncleared flags, compliance since watermark. Conversation produces narrative edits → commit → watermark advances + flags cleared on resolution, including the "nothing durable" outcome (D18).

**`/assess <client>`** — the evaluation workflow (P3-3): pulls compliance trend, conversation span, and the calibration record (draft-vs-final diffs, rejections, dismissals, confidence values). Produces: (a) client assessment → narrative edits; (b) agent performance findings → prompt-file edits; (c) process observations → for the operator. Output format is a starting convention, expected to evolve in the design plane itself.

**`/tune-prompts [agent]`** — evidence-first, cross-client: aggregates the calibration record ("your edits shortened 80% of coach drafts", "router false-positives cluster on status updates"), proposes specific edits to prompt files / few-shot examples / `autonomy.yaml`, commits.

**Studio instructions:** the meta-agent's own operating rules (role, read-only discipline, commit conventions, these workflow definitions) live in a versioned studio config — the CLAUDE.md of coaching-ops sessions — itself tunable like any knowledge file.

---

## 8. Schema Amendments to Phase 2 (additive; applied to `PHASE_2_DATA_MODEL.md`)

1. `batches.dismissed_at TEXT` — operator dismissal of an awaiting-response item (§6).
2. `compliance_days.followup_state TEXT CHECK (IN ('pending','handled','dismissed'))`, NULL unless the day closed as `miss` (§5).

Both are new nullable columns; no approved structure changes.

## 9. Phase 3 Decision Record

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| P3-1 | Response taxonomy | `gm_ack`, `status_ack`, `coaching_answer`, `accountability_followup` | Operator approved (2026-07-07) as "good for now"; taxonomy keys both `drafts.response_type` and autonomy policy |
| P3-2 | Miss handling | Miss → pending follow-up triage item; never an automatic message; handled/dismissed states audited | Operator confirmed (2026-07-07); accountability-first without ceding the highest-stakes moment to automation |
| P3-3 | Assessment inputs | Compliance trend + conversation span + calibration record | Operator approved (2026-07-07) as "good for now"; extensible in the design plane |
| P3-4 | Always-draft rule | Coach agent must end with `draft_response`; doubts go in `note`, never a refusal | At Level 0 the operator asked for the draft; a refusal wastes the trigger |
| P3-5 | Router uncertainty bias | `needs_response` defaults true under uncertainty; dismissals logged as calibration | Asymmetric error cost: silent ignored question ≫ dismissible queue item |
| P3-6 | Runtime delegation | None in v1; mechanism reserved as tool-registered subagents with JSON contracts | Nothing to delegate to yet; seam specified so domains slot in without redesign |
| P3-7 | Prompts as living templates | This doc fixes contracts (schemas, invariants); prompt prose is v1 seed, tuned in design plane | The design plane is the tuning loop; git is the record |
| P3-8 | Triage as pure queries | Queue items derived from state + two new dismissal/follow-up columns; no queue table | Derive-don't-duplicate; dismissal needed persistent state, added minimally |

## 10. Deferred to Phase 4

Build order and incremental testing strategy; config surface consolidation (debounce, context window, staleness threshold, max tool turns); dev-clock + snapshot/restore harness; state-machine replay tests; studio config authoring; query-helper implementation shape.
