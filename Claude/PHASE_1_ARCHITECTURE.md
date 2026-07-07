# Phase 1 — System Architecture Document

**Status:** ✅ APPROVED by operator — 2026-07-07
**Date:** 2026-07-07
**Scope:** High-level system architecture for the coaching bot redesign. Detailed data schemas (Phase 2), agent prompts/tools (Phase 3), and implementation plans (Phase 4+) are out of scope here.

---

## 1. Architectural Overview

The system spans **two planes**:

- **Runtime plane** — a single always-on Node.js/TypeScript process, event-driven, API-based (Anthropic API), that serves clients: ingests Telegram messages, classifies, tracks compliance, drafts responses for operator approval.
- **Design plane** — an interactive Claude Code (CLI) session in this repo, billed to the operator's subscription, where the operator converses with a meta-agent to iterate the bot itself: refine agent prompts and few-shot calibration, update client narratives, and assess client and agent performance. The bot is iteratively designed through operator feedback; this plane is where that feedback loop lives.

Every inbound message is durably persisted *before* any processing occurs. All runtime state lives in SQLite; tunable knowledge (prompts, narratives) lives in version-controlled files. Nothing load-bearing lives in memory. The process is designed to be killed and restarted at any moment without data loss or state corruption.

**Runtime plane topology:**

```
                        ┌─────────────────────────────────────────────┐
                        │                ADMIN UI (SPA)               │
                        │  triage queue · approval queue · roster ·   │
                        │  client detail · quick edits · audit        │
                        └──────────────────┬──────────────────────────┘
                                           │ HTTP (authenticated)
┌──────────┐   ┌─────────────┐   ┌─────────▼─────────┐   ┌──────────────┐
│ Telegram │──▶│  CHANNEL    │──▶│    CORE SERVICE   │◀──│  SCHEDULER   │
│ (Grammy) │◀──│  ADAPTER    │   │                   │   │ (reconcile-  │
└──────────┘   │             │   │  ┌─────────────┐  │   │  based day   │
               │ (interface; │   │  │AGENT RUNTIME│  │   │  closure)    │
               │  Telegram   │   │  │ router →    │  │   └──────────────┘
               │  is sole    │   │  │ primary     │  │
               │  impl.)     │   │  │ agent →     │  │
               └─────────────┘   │  │ subagents   │  │
                                 │  └──────┬──────┘  │
                                 │         │ tools   │
                                 │  ┌──────▼──────┐  │
                                 │  │REPOSITORIES │  │
                                 │  └──────┬──────┘  │
                                 └─────────┼─────────┘
                              ┌────────────┼────────────┐
                        ┌─────▼─────┐            ┌──────▼──────────┐
                        │  SQLite   │            │ KNOWLEDGE FILES │
                        │ (state)   │            │ (prompts,       │
                        └───────────┘            │  narratives)    │
                                                 └─────────────────┘
```

**Design plane topology:**

```
Operator ⇄ Claude Code session (meta-agent, interactive conversation)
              │ reads (read-only)          │ writes (direct, git-versioned)
              ▼                            ▼
        SQLite state                 Knowledge files
  (messages, compliance,        (agent prompts, few-shots,
   approval/edit history,        client narratives)
   audit log)                          │
                                       ▼
                        Runtime reads files fresh on each
                        invocation → changes take effect
                        on the next client message
```

---

## 2. Components

### 2.1 Channel Adapter

A thin translation layer between messaging channels and the core system. The core never imports channel SDKs; channel code never contains business logic.

**Contract (conceptual):**
- Inbound: channel event → neutral message `{ clientId, text, timestamp, channelMessageRef }` → core pipeline
- Outbound: core requests "send text to client" → adapter resolves channel identity → delivers
- Owns the **channel identity ↔ client identity mapping** (Telegram chat ID ↔ internal client ID). The rest of the system only sees internal client IDs.

Telegram (Grammy, long polling) is the only implementation now. The layer is deliberately minimal — one interface, one implementation, one identity table. We are buying a *seam* (testability, quarantined channel quirks, future channel additivity), not multi-channel machinery.

Raw channel payloads are logged alongside the neutral message for debugging.

### 2.2 Core Service — Inbound Pipeline

Every step persists its result before proceeding; a crash at any point resumes cleanly.

```
1. Message arrives via adapter
2. PERSIST message (durable, immediately)
3. Sender verified?
     - pending_verification → store only; surface in triage queue; STOP
     - blocked → ignore; STOP
4. Debounce: wait ~2–3 min after the client's last message,
   then process the burst as one batch
5. Two independent Haiku calls run IN PARALLEL on the batch:
   a. GM CLASSIFIER — runs on every batch until today is Compliant
      (the D9 short-circuit is the only gate: a DB read, not an
      LLM judgment) → compliance state machine update
   b. ROUTER — response shaping only: primary_intent (gm_checkin |
      coaching_question | status_update | other) + needs_response.
      Never a compliance input.
6. Batches needing a reply → surfaced in the triage queue as an
   "awaiting response" item (labeled with primary_intent)
7. Operator triggers a draft (autonomy Level 0 — §2.4) → Primary
   Coaching Agent → draft to approval queue → operator reviews/
   edits/sends → adapter delivers → outbound message persisted
```

The always-automatic portion (steps 1–6) is **Haiku-only** — persistence, verification gating, routing, GM classification, and compliance updates run whether or not the operator is present, at negligible cost. The Sonnet coaching agent runs only when the operator requests a draft, until the autonomy ladder opens (§2.4).

Debounced near-real-time processing **replaces the hourly batch**. This keeps the "handle message bursts as one unit" benefit while eliminating up-to-59-minute latency. The 2–3 minute pause also reads as natural human pacing.

### 2.3 Agent Runtime (Runtime Plane)

**Pattern:** cheap deterministic router → primary agent with tools → specialized subagents. Most messages (bare GMs) never reach an expensive model. All runtime agents use the **Anthropic API** (client-facing work stays off the operator's consumer subscription — terms and reliability both require it).

| Agent | Model | Role |
|---|---|---|
| **Router** | Haiku (forced tool-call) | Response shaping only: `primary_intent` + `needs_response` per batch. Never a compliance input (D23). |
| **GM Classifier** | Haiku (forced tool-call) | Sole authority on the compliance question (D23). Preserved from prototype, including reasoning-memory few-shot overrides. Runs on every batch, in parallel with the router, until the day is Compliant — the D9 short-circuit is its only gate. |
| **Primary Coaching Agent** | Sonnet (tool-calling loop) | Owns the coaching persona. Composes all client-facing drafts. Invoked on operator draft-trigger at autonomy Level 0; automatically at higher levels (§2.4). |

Narrative maintenance and client/agent assessment are **not** runtime agents — they are design-plane workflows (§2.9).

**Subagent call semantics:** a subagent is invoked like a function — scoped input, own narrow prompt, own restricted tools — and **returns a structured result to its caller**. Subagents never talk to the client and never write to the outbound queue. The primary agent synthesizes the final draft. One caller, one voice, one draft-producing point. Future coaching domains (nutrition, training) plug in as new subagents + tool sets under the same semantics.

**Primary agent tools (high level; schemas in Phase 3):**
- `get_client_narrative`, `get_compliance_summary`, `get_recent_conversation` — reads via repositories/knowledge files
- `draft_response(text, confidence, response_type)` — writes to the approval queue; **agents can never send directly**
- `flag_for_narrative(note)` — marks a narrative-worthy moment; feeds the staleness nudge (§2.9). Runtime agents **read** the narrative but never write it.

**Prompts and calibration as files:** every runtime agent's system prompt and few-shot examples are knowledge files, read fresh on each invocation (no caching — cost is nil at this scale). A design-plane edit takes effect on the next client message, with no restart or deploy step.

**Observability by default:** every LLM call and tool invocation is an audit-log row (model, prompt file version, tokens, latency, result), surfaced in the admin UI.

### 2.4 Approval Pipeline / Autonomy Ladder

Every outbound message is a DB row with a lifecycle: `draft → approved → sent` (rejected/edited/stale along the way). The confidence gate generalizes to a three-level **autonomy ladder**, configured per response type. Nothing about the agent runtime, tools, or queue schema differs between levels — only *when* the draft call fires and whether a human approves it. Moving a response type up the ladder is a config change, not new code.

| Level | Drafting | Sending | Status |
|---|---|---|---|
| **0 — Operator-triggered draft** | Operator clicks "draft" on an awaiting-response item | Operator reviews/edits, sends | **Start here** for all non-GM responses |
| **1 — Auto-draft** | Pipeline drafts automatically on burst completion | Operator reviews/edits, sends | Deferred; auto-supersession activates here |
| **2 — Auto-send** | Automatic | Automatic above a confidence threshold | Eventual goal for high-confidence response types |

**Draft granularity and freshness:**
- Drafts are per **burst**, not per message: one draft reply covers everything unanswered. Bare GM check-ins needing no reply produce no queue entry.
- **One active draft per client**, with a **send-time freshness check**: if new inbound messages arrived after the draft was generated, the send is blocked and the draft marked **stale**. At Level 0, regeneration is the operator clicking draft again; at Level 1, re-drafting over the full unanswered span happens automatically.
- Invariant at every level: *a reply can never be sent that predates what the client last said.*
- Stale/rejected/edited drafts are retained — the operator's edits are primary calibration signal for design-plane tuning sessions.

### 2.5 Scheduler — Reconciliation-Based Time Handling

**Design principle: derive state from timestamps; never depend on having been awake at a moment in time.**

There are no "at midnight do X" ticks. Each client stores a `last_reconciled_date`. On every startup and every scheduler pass, the system computes all unresolved client-days between then and now and closes them out via the compliance state machine (mark Miss, hold Pending Review, update streak). Reconciliation is **idempotent** — running it twice changes nothing.

Consequences:
- Server downtime (hours or days) is fully recovered on next boot: the reconciler walks forward through every missed day per client, deterministically.
- Clock leaps forward (including dev-clock time simulation) are handled identically — a leap is indistinguishable from downtime. The existing advance-day/advance-hour dev tooling becomes the test harness for this logic.
- The 5pm daily reply from the prototype is **removed** (operator decision). Scheduled work reduces to day reconciliation.

**Backward time is refused, not handled.** Reconciliation is strictly forward-only: if effective time is ever earlier than a client's `last_reconciled_date`, the reconciler does nothing but log a warning — it never un-marks misses or rewinds streaks. No legitimate production scenario moves time backward (timezones are per-client IANA zones, not clock math), so backward motion is by definition a dev-tooling situation, and teaching the state machine to run in reverse would double its complexity for a test-only case.

**Dev clock rewind via snapshot/restore.** SQLite being a single file makes rewind nearly free: when a time simulation starts (first advance-day/advance-hour), dev tooling snapshots the DB file; "reset clock" restores the snapshot and the clock together. State and time stay consistent by construction — simulated days aren't "undone," they simply never happened. Knowledge files need no snapshotting (time simulation doesn't touch narratives or prompts).

### 2.6 Persistence — State in SQLite, Knowledge in Files

**Two-part split, matched to each plane's medium:**

**State → SQLite** (via `better-sqlite3`), replacing flat JSON files:
- Zero cost, zero ops, single file — fits the near-free constraint and local hosting.
- Transactional — fixes crash-mid-batch inconsistency.
- Queryable — agents and design-plane sessions can query history properly.
- Trivially handles 10–50 clients.

Core entities (schemas in Phase 2): `clients` (incl. lifecycle status, timezone, `last_reconciled_date`), `messages` (all inbound/outbound, durable), `compliance_days`, `outbound_queue` (with approve/edit/reject history), `narrative_meta` (watermark + staleness counters + flags), `llm_audit_log`, `channel_identities`.

**Knowledge → version-controlled markdown files**, natively readable and editable by a Claude Code session, hot-read by the runtime:
- `prompts/` — runtime agent system prompts, coaching persona, few-shot calibration, classifier reasoning-memory. Lives in the **product repo**.
- Client narratives — one file per client, in a **separate local data directory with its own private git history**. Narratives are personal data about real people and must never ride along in a repo that could be pushed anywhere.

All SQLite access goes through a **repository layer**; a future move to hosted Postgres is a repository swap, not a rewrite. **The system starts fresh (D22):** no data is migrated from the prototype's JSON files; the prototype is retired and clients onboard anew through the verification flow.

### 2.7 Admin UI (Runtime Plane)

The operator's daily cockpit, designed around a **multi-client queue workflow** (work a queue, not tabs). Division of labor: **daily triage happens in the UI; deep work happens in the design plane (§2.9).**

- **Triage-first home:** one cross-client list of items needing the operator — awaiting-response items (labeled with primary_intent, with a draft trigger), pending draft approvals, pending-review classifications, narrative staleness nudges, new unverified contacts.
- **Client detail view:** conversation history, compliance calendar, narrative (read view + **quick manual edits** — typo fixes, one-line additions; substantive narrative work belongs in the design plane), per-client audit log, narrative staleness indicator.
- **Client administration:** verify/block new contacts; compliance corrections (fix streaks, resolve pending reviews) via audited repository operations; per-client **reset** (wipe history/compliance, keep registration) and **delete** (remove entirely) — confirmation-gated, executed as a single repository transaction, recorded in the audit log.
- **Tech:** small Vite + React SPA served by the same core process, replacing the 1200-line HTML string template. Polling initially; SSE only if needed.
- **Auth:** single operator token/password with session cookie. Required before any cloud deployment; added from day one.

### 2.8 Client Lifecycle & Verification

Any Telegram user can message a public bot, so clients carry a lifecycle status:

```
pending_verification → active → (future: graduated / dropped)
                     ↘ blocked
```

- First contact auto-registers as `pending_verification`: messages are stored, but **no pipeline runs** — no classification, no compliance, no agent, no replies.
- The operator verifies (→ `active`) or blocks from the triage queue. Blocked senders are silently ignored.
- This field is also the foundation for the future onboarding/intake flow.

### 2.9 Design Plane — The Operator's CLI Studio

The bot is iteratively designed through operator feedback. The design plane is where that happens: the operator opens a **Claude Code session in this repo** and converses with a specialized meta-agent to evolve the bot. Interactive, conversational, subscription-billed — no terminal work is ever required for daily client operations, only for tuning the system itself.

**Scope — what a design-plane conversation can modify (operator decision):**
- **Client narratives** — the living per-client documents (current focus, obstacles, life context, what the client responds to), updated through dialogue.
- **Agent prompts & few-shots** — the runtime agents' system prompts, coaching-persona calibration examples, and classifier reasoning-memory.
- **Not in scope:** compliance-state corrections (admin UI, audited repository operations) and code changes (normal development workflow, not the tuning loop).

**Write model — direct write, versioned (operator decision):** the conversation edits knowledge files directly; the operator is present and in the loop live, so a second approval queue would be reviewing oneself. Safety comes from versioning: every change is a git commit with rollback. **Git history is the design plane's audit trail** (SQLite's audit log covers the runtime plane).

**Read access:** the session reads runtime state from SQLite **read-only** — conversation history, compliance trends, and the operator's approve/edit/reject patterns on drafts (primary signal for calibrating the coaching agent). All writes go through knowledge files only.

**Core workflows (full specs in Phase 3, delivered as project skills/commands):**
- **Narrative update** — operator-triggered only (no automatic triggers; see below). Conversationally review a client's history since the watermark and update their narrative file.
- **Assessment** — the deep review: client trajectory, what's working, agent performance critique ("your edits consistently shorten my drafts"), outputting narrative updates and prompt/process refinements in one conversation. Absorbs what was previously specified as a separate runtime "Assessment Agent."
- **Prompt tuning** — adjust persona, few-shots, or classifier guidance based on accumulated approve/edit/reject evidence.

**Narrative trigger policy (operator decision):** the Narrative Updater is **operator-triggered only**. Rationale: in full-approval mode the operator already sees every exchange live, so automatic detection of "meaningful moments" is redundant; automatic triggers (exchange-completion, daily sweep) are deferred and **linked to the confidence gate** — when autonomy opens and messages flow unreviewed, they return to the table.

**Non-overlapping history — watermark rules:**
- Per client, `narrative_meta` tracks "narrative reflects history through timestamp X."
- Each narrative session processes from the watermark to now by default; the watermark advances when the update is resolved (changes committed, or explicitly "nothing durable here").
- Optional lookback override re-covers old ground deliberately; safe by construction because updates always diff against the current narrative.

**Staleness nudge (guard against silent drift):** the narrative is the context every runtime agent reasons from, so a stale narrative silently degrades draft quality. The runtime counts non-GM exchanges since the watermark (plus any `flag_for_narrative` marks) — cheap bookkeeping, no LLM — and surfaces a staleness item in the triage queue past a threshold. The system never updates the narrative itself; it makes "this narrative is falling behind" visible and leaves the trigger to the operator.

---

## 3. Tech Stack Decision

**Decision: stay Node.js/TypeScript.** Python was the only serious alternative (LLM-tooling ecosystem) and is rejected:

- Operator fluency in TypeScript; well-built domain logic (compliance state machine, dev clock) ports directly.
- Grammy and the Anthropic SDK are first-class in TypeScript. The agent framework needed here is a routing loop + tool dispatch — small and bespoke, not ecosystem-dependent.
- A language rewrite violates "iterate safely with live clients" for zero architectural gain.

Stack: Node.js 20+, TypeScript, Grammy (Telegram), Express (retained), `better-sqlite3` with hand-written SQL behind repositories, Vite + React for the admin SPA, tsx for dev execution. Design plane: Claude Code (operator's existing subscription).

---

## 4. Deployment Posture

**Decision: run locally now; design cloud-ready from day one.**

Cloud-readiness means: SQLite as a portable single file, all configuration via environment variables, authenticated admin UI, and no dependence on local-machine specifics. When reliability demands it, the runtime plane moves to a small VPS or free-tier host without redesign. Reconciliation-based scheduling (§2.5) makes local hosting's downtime tolerable in the meantime.

The design plane is inherently local (it's the operator at their machine) and does not need to move; if the runtime deploys to a VPS, the design plane needs a synced copy of state for read access and a push path for knowledge files — a Phase 4 logistics detail, not an architectural change.

---

## 5. Design Principles (Applied Throughout)

1. **Persist before processing** — no load-bearing in-memory state, ever.
2. **Reconcile, don't tick** — time-based state is derived from timestamps, idempotently.
3. **Runtime agents propose; the operator disposes** — no runtime agent can send a message without passing the approval pipeline (until the autonomy ladder is deliberately opened), and none can write the narrative or their own prompts. Knowledge changes happen only where the operator is present: the design plane or admin UI quick edits.
4. **Modularity via module boundaries** — single process, single DB; coaching domains plug in as new subagents + tool sets + prompt files + schema tables, not new services.
5. **Observable by default** — every LLM call, tool invocation, and state change is logged (SQLite audit log for the runtime plane, git history for the design plane) and visible in the admin UI.
6. **Iterate safely** — the redesign starts fresh (D22): the prototype is retired rather than migrated. Within the new system, changes ship incrementally, with rollback via git-versioned knowledge files and DB snapshots.

---

## 6. Decision Record

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| D1 | Tech stack | Stay Node.js/TypeScript | Operator fluency; portable domain logic; first-class SDKs; rewrite = risk without gain |
| D2 | Persistence (state) | SQLite behind repositories | Free, transactional, queryable; repository layer preserves a Postgres path |
| D3 | Hosting | Local now, cloud-ready design | Operator decision (2026-07-06) |
| D4 | Processing cadence | Debounced near-real-time (~2–3 min) replaces hourly batch | Operator-accepted latency; batches bursts; human-like pacing |
| D5 | Admin UI | Vite + React SPA, same process | Operator accepted frontend build step; dashboard is the primary workspace |
| D6 | 5pm daily reply | **Removed** | Operator decision (2026-07-06); daily GM check + streak remain |
| D7 | Downtime/clock handling | Reconciliation-based scheduler | Local hosting makes downtime routine; idempotent catch-up required |
| D8 | Subagent semantics | Call/return to caller; primary agent synthesizes all drafts | Consistent voice; single draft-producing point; simple audit |
| D9 | Compliance short-circuit | Skip GM classifier when day already Compliant; message still routed | Cost control without losing coaching-question handling |
| D10 | Open bot exposure | Lifecycle status + manual verification gate | Public bots receive strangers; unverified senders trigger no pipeline |
| D11 | Data clearing | Per-client reset & delete as first-class, transactional admin actions | Operator requirement; promoted from dev tool |
| D12 | Response rate mechanic | Not carried forward | Removed in original constraints |
| D13 | Two-plane architecture | Runtime plane (API, always-on, client-facing) + design plane (Claude Code CLI, interactive, operator-facing) | Operator intent (2026-07-07): the bot is iteratively designed via conversation with a meta-agent. Client-facing inference stays on the API (terms + reliability); the tuning loop uses the operator's subscription |
| D14 | Design-plane scope | Narratives + agent prompts/few-shots; not compliance corrections, not code | Operator decision (2026-07-07) |
| D15 | Design-plane write model | Direct write, git-versioned; no second approval queue | Operator decision (2026-07-07): operator is present live; git provides rollback + audit |
| D16 | Persistence (knowledge) | Prompts/few-shots/narratives as markdown files; prompts in repo, narratives in a separate private git directory | Operator decision (2026-07-07); files are the design plane's native medium; narrative privacy requires separation from the pushable repo |
| D17 | UI vs design plane | Admin UI keeps quick narrative edits + staleness view; deep work in the design plane | Operator decision (2026-07-07): daily triage in one tool, deep work in the other |
| D18 | Narrative trigger policy | Operator-triggered only; watermark advances on resolution; passive staleness nudge in triage queue | Operator decision (2026-07-07); automatic triggers deferred, linked to confidence-gate opening |
| D19 | Draft granularity & freshness | One draft per burst; one active draft per client; send-time freshness check blocks stale sends. Auto-regeneration deferred to autonomy Level 1 | Operator decision (2026-07-07, revised same day with D21); a reply can never predate the client's last message; stale drafts retained as audit/calibration signal |
| D20 | Backward time handling | Reconciliation is forward-only (warn + no-op on backward time); dev clock rewind via DB snapshot/restore | Operator decision (2026-07-07); no production scenario moves time backward; reverse state-machine logic would double complexity for a test-only case |
| D21 | Drafting trigger | Non-GM drafting starts at autonomy Level 0 (operator-triggered); automatic pipeline is Haiku-only; confidence gate generalized to a 3-level autonomy ladder per response type | Operator decision (2026-07-07); in full-manual mode an eager Sonnet draft is spent before knowing it's wanted; ladder makes auto-draft/auto-send config flips, not new code |
| D22 | Prototype data | **Fresh start** — no migration from the prototype's JSON; prototype retired; clients onboard anew via the verification flow | Operator decision (2026-07-07, Phase 2); supersedes the gradual-migration posture originally stated in §2.6 and principle 6 |
| D23 | GM detection authority | GM classifier runs on every batch until the day is Compliant; router carries no GM-detection output and is never a compliance input; the two calls run in parallel | Operator decision (2026-07-07, Phase 2); "does this contain a GM?" *is* the classification question — a router pre-gate would duplicate the judgment with a less-calibrated prompt and risk false Misses, the most trust-destroying error. Classifier errors resolve to Pending Review (hold, never reset) — conservative in the direction the domain logic already chose |

---

## 7. Explicitly Deferred

- **Phase 2:** full data schemas, storage abstraction details, conversation-history-as-context strategy, narrative document structure (file format + `narrative_meta` bookkeeping), fresh-start bootstrap.
- **Phase 3:** runtime agent prompts, tool schemas, routing logic detail, autonomy-ladder policy design (per-type levels, confidence thresholds); design-plane workflow specs (narrative update, assessment, prompt tuning) as project skills/commands, including the meta-agent's read-access tooling to SQLite.
- **Phase 4:** build order, interfaces, testing strategy, migration/cutover sequencing; design-plane logistics if the runtime moves off the local machine.
- **Future domains** (nutrition, training, metrics, onboarding): architecture accommodates them as pluggable modules; none are designed yet ("lean data, extend later").
- **Automatic narrative triggers** (exchange-completion, daily sweep): deferred until the confidence gate opens (D18).
