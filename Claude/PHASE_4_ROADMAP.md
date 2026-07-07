# Phase 4 — Implementation Roadmap

**Status:** ✅ APPROVED by operator — 2026-07-07
**Date:** 2026-07-07
**Depends on:** Phases 1–3 (all approved): `PHASE_1_ARCHITECTURE.md` (D1–D23), `PHASE_2_DATA_MODEL.md` (P2-1–P2-8), `PHASE_3_AGENT_FRAMEWORK.md` (P3-1–P3-8)
**Scope:** Buildable units, inter-component interfaces, testing strategy, and ordered build stages with verification checkpoints. Code-level detail (exact TypeScript interfaces, API contracts, file-by-file specs) is Phase 5, produced stage-by-stage during the build.

---

## 1. Ordering Principles

1. **The compliance state machine is the crown jewel — built and tested before any I/O exists.** Pure logic, no Telegram, no LLM, no UI; correctness matters most there and testing is cheapest there.
2. **Every stage ends with something the operator can run and verify** — a demo checkpoint, not just green tests. Determinism arrives early; LLMs and Telegram arrive late.
3. **The prototype keeps serving the live client untouched until Stage 8.** Nothing in stages 0–7 touches its process or its `data/`.
4. **Operator checkpoint at every stage (P4-2):** each stage ends at its *Verify* line and waits for operator confirmation before the next begins — the Progressive Depth Protocol carried into the build.

## 2. Repo Strategy (P4-1)

Same repository. The prototype stays untouched at `src/`; the new system builds under **`v2/`**. At retirement (Stage 8) the prototype moves to `legacy/` and `v2/` claims the root. Same-repo keeps `Claude/` docs, prompts, and the studio config in one place — which the design plane depends on.

```
fitness-chat-bot/
├── src/                  # PROTOTYPE — untouched, live, until Stage 8
├── data/                 # prototype JSON — frozen archive at Stage 8 (D22)
├── Claude/               # phase docs (this file), reference docs
├── .claude/              # studio config + skills (Stage 7; repo root because
│                         #   design-plane sessions run at repo root)
└── v2/
    ├── src/
    │   ├── config/       # all constants, env parsing
    │   ├── clock/        # dev-clock service (offset-aware now())
    │   ├── db/           # connection, migration runner, snapshot/restore
    │   ├── repos/        # the seven repositories (Phase 2 §5)
    │   ├── domain/       # compliance state machine, reconciler — pure logic
    │   ├── adapters/     # channel interface, fake/, telegram/
    │   ├── pipeline/     # ingestion, debounce, batch processing
    │   ├── agents/       # prompt assembly, LLM client, router/classifier/coach
    │   ├── approval/     # draft lifecycle, autonomy policy, send path
    │   ├── server/       # Express API + auth (serves admin UI)
    │   └── admin-ui/     # Vite + React SPA
    ├── prompts/          # five prompt files + autonomy.yaml (Phase 3)
    ├── migrations/       # 001_init.sql, …
    └── test/             # suites per §4
```

Client narratives live **outside the repo** in a private directory with its own git history (D16); its path is config.

## 3. Build Stages

Strictly linear except stages 6 and 7, which are independent after 5 and may build in either order.

### Stage 0 — Scaffold
**Units:** `v2/` skeleton; TypeScript + Vitest config; migration runner + `001_init.sql` (Phase 2 §2 as amended); config module — every tunable in one place (debounce window, context window, staleness threshold, max tool turns, autonomy file path, narratives path); dev-clock service — all other modules get time only from here, from day one.
**Verify:** migrations create the full schema on a fresh file; clock offset advance/reset works from a CLI.

### Stage 1 — Persistence core
**Units:** the seven repositories (`ClientRepo`, `MessageRepo`, `ComplianceRepo` shell, `DraftRepo`, `NarrativeStore`, `PromptStore`, `AuditRepo`) with better-sqlite3 transactions; audit-event plumbing; `NarrativeStore` file+DB split.
**Interfaces introduced:** repository contracts (domain operations, not row CRUD — Phase 2 §5).
**Tests:** repository suite on temp-file SQLite; atomicity assertions (reset/delete leave no partial state); one-active-draft and freshness constraints enforced by the DB itself.
**Verify:** suite green; a seeded dev DB survives kill-and-restart with no inconsistency.

### Stage 2 — Compliance engine
**Units:** state machine behind `ComplianceRepo` (sole writer, P2-4); reconciler (forward-only, idempotent, per-client walk — D7/D20); streak derivation; miss → `followup_state='pending'` (P3-2); **snapshot/restore dev tooling** (snapshot on first time-sim action, restore on clock reset).
**Tests — the heart of the suite:** table-driven replay: sequences of (day, event) → expected state/streak, covering every transition, pending-review holds, duplicate GMs, multi-day downtime catch-up, backward-time refusal (warn + no-op), double-run idempotency. Dev clock makes 30 simulated days run in milliseconds.
**Verify (operator):** simulate a month of GM/miss/pending patterns from a CLI; state stays correct through crashes, clock leaps, and rewinds.

### Stage 3 — Ingestion
**Units:** channel adapter interface + **fake adapter first**, then Telegram/Grammy adapter; identity mapping; auto-register → `pending_verification` gating (D10); debounce/batch lifecycle (`open→pending→processed`) with startup crash-sweep (P2-5).
**Interfaces introduced:** the channel contract (neutral message in, send out — Phase 1 §2.1).
**Tests:** full pipeline integration through the fake adapter — no network, no LLM (batches close as `pending`); crash-recovery scenarios (kill between persist and batch-close; restart; assert convergence).
**Verify (operator):** message a dev bot on Telegram; rows appear with raw payloads; an unverified stranger is stored-but-inert and surfaces as a triage row.

### Stage 4 — Classification
**Units:** LLM client + `llm_calls` audit; prompt assembly with git-hash capture (Phase 3 §1); router + GM classifier running in parallel per batch (D23); compliance wiring (valid GM → state machine; classifier error → pending review); the five prompt files + `autonomy.yaml` seeded from Phase 3.
**Tests:** contract tests on mocked LLM responses (schema conformance, forced-tool parsing, error semantics); thin live-Haiku smoke suite (on demand, not CI).
**Verify (operator):** "GM" sent on Telegram → classified → streak increments. **The accountability loop is alive end-to-end.**
**Cost note:** from here, dev runs spend real (Haiku-scale) API pennies; the fake-LLM path remains the test default.

### Stage 5 — Response path
**Units:** coach agent — bounded loop, max-turns force to `draft_response` (P3-4); the four tools with deterministic handlers; ContextBuilder (Phase 2 §4); draft lifecycle with one-active + send-time freshness in SQL (P2-6, D19); `autonomy.yaml` read, failing closed to Level 0; send via adapter; `flag_for_narrative` → staleness feed.
**Tests:** tool-loop tests with scripted LLM turns (1-turn happy path, pull-then-draft, max-turns force); freshness race (message lands between draft and send → send refused, draft stale).
**Verify (operator):** trigger a draft via API for a real dev conversation; edit; send; message arrives in Telegram; audit trail complete (prompt hashes, tokens, tool calls).

### Stage 6 — Admin UI
**Units (in order):** auth (operator token, session cookie) → triage queue (all six item types, P3-8; dismissals) → client detail (conversation, compliance calendar, narrative view + quick edit with git commit, audit log, staleness indicator) → approve/edit/send flow → admin actions (verify/block, compliance corrections, reset/delete with confirmation) → dev panel (clock, snapshot/restore).
**Tests:** API-level tests for every admin action (authorization, audit events, atomicity); UI manually exercised against seeded dev data.
**Verify (operator):** run a full simulated coaching day — triage → draft → edit → send → dismiss → correct a pending review — without touching a terminal.

### Stage 7 — Design plane
**Units:** private narratives repo init; studio config (`.claude/` — meta-agent role, read-only discipline, commit conventions, privacy rules) + the three skills (`/narrative-update`, `/assess`, `/tune-prompts` per Phase 3 §7); read-only DB query helper; watermark/flag bookkeeping helper (the design plane's only DB write path, audited).
**Tests:** query helper provably read-only (write attempt fails); bookkeeping helper transactional.
**Verify (operator):** run `/narrative-update` on dev data end-to-end: conversation → narrative file edit → git commit → watermark advance → staleness clears in the UI.

### Stage 8 — Hardening & go-live
**Units:** nightly DB snapshot job (reconciliation-safe); error-surfacing pass — every failure lands in triage or a visible log, none swallowed; **shakedown week** — operator as a fake client, daily real use, both planes exercised.
**Go-live sequence:** author the live client's initial narrative in a design-plane session (prototype `data/` archive as reference — D22) → verify him on the new system → swap the Telegram token → watch first GM classify → retire prototype (`src/` → `legacy/`, process stopped, `data/` frozen).
**Verify (operator):** live client checks in on the new system. Day 1, streak 1, narrative in place.

## 4. Testing Strategy Summary

| Layer | Approach |
|---|---|
| State machine / reconciler | Table-driven replay tests — the heart of the suite (Stage 2) |
| Repositories | Real SQLite on temp files; transaction/atomicity assertions |
| Pipeline | Integration via fake adapter; kill-and-restart convergence scenarios |
| Agents | Contract tests on mocked responses; thin live-model smoke suite, on demand only |
| Time logic | Everything under the dev clock; downtime = clock leap + restart in-test |
| Admin API | Endpoint tests: auth, audit, atomicity |
| UI | Manual against seeded dev data |

Framework: **Vitest**. The fake adapter + dev clock + snapshot/restore together mean the entire system short of real Telegram/LLM runs deterministically on the operator's machine.

## 5. Phase 4 Decision Record

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| P4-1 | New-code location | Same repo, `v2/`; prototype untouched at `src/` until Stage 8, then → `legacy/` | Operator decision (2026-07-07); prototype is live in production; docs/prompts/studio config belong beside the code the design plane tunes |
| P4-2 | Build cadence | Operator checkpoint at every stage's Verify line | Operator decision (2026-07-07); matches iterative style and the phase protocol |
| P4-3 | Test framework | Vitest | Native TS/ESM, fits the tsx toolchain |
| P4-4 | Fake-first integrations | Fake adapter before Telegram; mocked LLM before live; live smoke suites never in the default test run | Determinism and zero cost in the default loop |
| P4-5 | Stage 6/7 ordering | Independent after Stage 5; either order | No shared units; UI and studio touch different surfaces |

## 6. Phase 5 Protocol

Phase 5 (code-level specs) is produced **stage-by-stage during the build**, not as one upfront document: at each stage start, a short component spec (exact interfaces, API contracts, file list) is presented, then implemented, then verified at the checkpoint. This keeps code-level detail grounded in what the previous stage actually shipped.
