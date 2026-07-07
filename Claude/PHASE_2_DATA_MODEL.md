# Phase 2 — Data Model & Persistence Specification

**Status:** ✅ APPROVED by operator — 2026-07-07
**Date:** 2026-07-07
**Depends on:** `PHASE_1_ARCHITECTURE.md` (approved; decisions D1–D22 referenced throughout)
**Scope:** Complete data schema, storage abstraction, narrative/prompt file formats, LLM context strategy, and fresh-start bootstrap. Agent prompts and tool schemas are Phase 3; build order is Phase 4.

---

## 1. Conventions

- **IDs:** ULIDs (26-char strings, time-sortable) for all primary keys. Internal client IDs never equal channel IDs — that mapping lives only in `channel_identities` (Phase 1 §2.1).
- **Timestamps:** UTC ISO-8601 strings (`TEXT`). SQLite has no datetime type; ISO strings sort correctly and are human-readable in queries.
- **Calendar dates:** `YYYY-MM-DD` computed in the **client's IANA timezone**. Day boundaries are per-client, never server-local — this is what makes reconciliation (D7) deterministic. All date math goes through one `clientDate(client, utcInstant)` utility; nothing else computes dates.
- **Effective time:** every read of "now" goes through the dev-clock service (offset-aware), including date computation — time simulation and production share one code path.
- **Mutation discipline:** rows are appended or status-transitioned, never destructively updated. The only hard deletes are client delete (D11, via `ON DELETE CASCADE`) and dev snapshot/restore (D20).
- **SQLite pragmas:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **Schema versioning:** numbered forward-only migration files (`migrations/001_init.sql`, …) tracked in `schema_migrations`. No down-migrations — rollback is a DB snapshot (consistent with D20 tooling).

---

## 2. SQLite Schema (State)

### 2.1 Identity & lifecycle

```sql
CREATE TABLE clients (
  id                   TEXT PRIMARY KEY,             -- ULID
  display_name         TEXT NOT NULL,
  timezone             TEXT NOT NULL,                -- IANA, e.g. 'America/New_York'
  status               TEXT NOT NULL DEFAULT 'pending_verification'
                       CHECK (status IN ('pending_verification','active','blocked',
                                         'graduated','dropped')),  -- last two reserved (Phase 1 §2.8)
  created_at           TEXT NOT NULL,
  verified_at          TEXT,
  last_reconciled_date TEXT                          -- YYYY-MM-DD, client tz (D7)
);

CREATE TABLE channel_identities (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                         -- 'telegram'
  external_id TEXT NOT NULL,                         -- Telegram chat id
  handle      TEXT,                                  -- @username at registration
  created_at  TEXT NOT NULL,
  UNIQUE (channel, external_id)
);
```

### 2.2 Conversation

```sql
CREATE TABLE messages (
  id                  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  direction           TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  text                TEXT NOT NULL,
  channel_message_ref TEXT,                          -- Telegram message id
  raw_payload         TEXT,                          -- JSON; inbound only, for debugging (Phase 1 §2.1)
  batch_id            TEXT REFERENCES batches(id),   -- inbound: set when debounce closes
  draft_id            TEXT REFERENCES drafts(id),    -- outbound: which approved draft produced it
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_messages_client_time ON messages(client_id, created_at);

CREATE TABLE batches (                               -- the debounced processing unit (D4, D19)
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','pending','processed')),
                    -- open: debounce window still running; pending: closed, awaiting
                    -- processing; processed: router + classifier (when applicable) done
  primary_intent    TEXT CHECK (primary_intent IN
                    ('gm_checkin','coaching_question','status_update','other')),
                    -- response shaping only — never a compliance input (D23)
  router_confidence REAL,
  needs_response    INTEGER NOT NULL DEFAULT 0,      -- reply-worthy per router; drives triage
  dismissed_at      TEXT,                            -- operator dismissed the awaiting-response
                                                     -- item (added Phase 3, P3-8)
  created_at        TEXT NOT NULL,
  processed_at      TEXT
);
CREATE INDEX idx_batches_client_status ON batches(client_id, status);
```

A crash mid-debounce loses nothing: `open` batches older than the debounce window are swept to `pending` on startup (persist-before-process, Phase 1 principle 1). An **"awaiting response" triage item** (D21) is simply: a processed batch with `needs_response = 1` and no non-stale draft covering it.

### 2.3 Compliance

```sql
CREATE TABLE compliance_days (                       -- the state machine's persistent form
  client_id            TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                 TEXT NOT NULL,                -- YYYY-MM-DD, client tz
  status               TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (status IN ('unknown','compliant','miss','pending_review')),
  streak_after         INTEGER,                      -- streak once resolved; NULL = hold
  resolved_at          TEXT,
  resolving_message_id TEXT REFERENCES messages(id), -- the GM that made it compliant
  followup_state       TEXT CHECK (followup_state IN ('pending','handled','dismissed')),
                                                     -- NULL unless day closed as miss;
                                                     -- miss follow-up triage (Phase 3, P3-2)
  PRIMARY KEY (client_id, date)
);

CREATE TABLE classifications (                       -- full GM-classifier audit trail
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  batch_id    TEXT NOT NULL REFERENCES batches(id),
  is_valid_gm INTEGER,                               -- NULL = classification failed → pending_review
  reasoning   TEXT,
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_classifications_batch ON classifications(batch_id);
```

**GM detection authority (D23):** the classifier runs on **every batch until the day is Compliant** — the D9 short-circuit (a DB read) is its only gate. The router carries no GM-detection output and is never a compliance input; the two Haiku calls run in parallel. A classifier *error* on a pre-Compliant batch resolves the day to `pending_review` (hold, never reset) — conservative in the direction the domain logic already chose.

State-machine invariants (enforced by `ComplianceRepo`, the sole writer):
- Transitions follow the Phase 1 / domain-knowledge state machine exactly; `pending_review` days hold indefinitely and hold the streak (`streak_after` stays NULL until resolution).
- The current streak is **not stored on `clients`** — it is `streak_after` of the most recent resolved day. One source of truth; recomputable by replaying days.
- Reconciliation (D7) walks `last_reconciled_date + 1 … today-1` per client, closing each `unknown` day to `miss` (or leaving `pending_review` held), strictly forward-only (D20).

### 2.4 Response

```sql
CREATE TABLE drafts (                                -- the approval queue (Phase 1 §2.4)
  id                        TEXT PRIMARY KEY,
  client_id                 TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  covers_through_message_id TEXT NOT NULL REFERENCES messages(id),
  draft_text                TEXT NOT NULL,
  final_text                TEXT,                    -- as actually sent; operator edits captured
  response_type             TEXT NOT NULL,
  confidence                REAL,
  status                    TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','approved','sent','rejected','stale')),
  autonomy_level            INTEGER NOT NULL DEFAULT 0,   -- ladder level in force (D21)
  created_at                TEXT NOT NULL,
  resolved_at               TEXT
);
CREATE INDEX idx_drafts_client_status ON drafts(client_id, status);
```

- **Freshness invariant (D19):** send is refused if any inbound message for the client is newer than `covers_through_message_id`; the draft is marked `stale` instead. Checked inside the send transaction.
- **One active draft per client:** partial unique index — `CREATE UNIQUE INDEX idx_drafts_one_active ON drafts(client_id) WHERE status = 'draft';`
- `draft_text` vs `final_text` diffs are the primary calibration signal for design-plane tuning (Phase 1 §2.4).

### 2.5 Narrative bookkeeping (content lives in files — §3)

```sql
CREATE TABLE narrative_meta (
  client_id    TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  watermark_ts TEXT                                  -- narrative reflects history through here (D18)
);

CREATE TABLE narrative_flags (                       -- from flag_for_narrative + operator marks
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('agent','operator')),
  created_at TEXT NOT NULL,
  cleared_at TEXT                                    -- set when watermark passes created_at
);
```

**Staleness score** (Phase 1 §2.9) is computed, never stored: uncleared flags + `needs_response` batches since `watermark_ts`; surfaced in triage past a threshold (config).

### 2.6 Observability

```sql
CREATE TABLE llm_calls (
  id               TEXT PRIMARY KEY,
  client_id        TEXT REFERENCES clients(id) ON DELETE SET NULL,
  batch_id         TEXT REFERENCES batches(id),
  agent            TEXT NOT NULL,                    -- 'router' | 'gm_classifier' | 'coach'
  model            TEXT NOT NULL,
  prompt_file_hash TEXT,                             -- git blob hash of the prompt version used
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  latency_ms       INTEGER,
  result           TEXT,                             -- JSON (tool calls, output)
  error            TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_llm_calls_client_time ON llm_calls(client_id, created_at);

CREATE TABLE audit_events (                          -- every state change with an actor
  id         TEXT PRIMARY KEY,
  client_id  TEXT,                                   -- no FK: events survive client deletion
  actor      TEXT NOT NULL CHECK (actor IN ('operator','system')),
  action     TEXT NOT NULL,   -- verified | blocked | reset | deleted | compliance_corrected |
                              -- draft_sent | draft_rejected | narrative_quick_edit | ...
  details    TEXT,                                   -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_client_time ON audit_events(client_id, created_at);

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

`prompt_file_hash` ties every LLM call to the exact prompt version that ran — the join point between the SQLite audit trail (runtime plane) and git history (design plane).

---

## 3. Knowledge Files

### 3.1 Client narratives (private data directory, own git history — D16)

One file per client: `<narratives_dir>/<client_id>.md`. Section structure **approved by operator** as matching his coaching mental model:

```markdown
---
client_id: 01J9XKQ3...
display_name: Mike
updated: 2026-07-07
---

## Snapshot
Two-3 sentences: who they are, where they are in the journey.

## Current Focus
The ONE thing this week (progressive-disclosure philosophy, made literal).

## Obstacles
Active friction: schedule, motivation patterns, injuries.

## What Works / What Doesn't
Coaching levers: responds to direct challenges; goes quiet when guilt-tripped.

## Life Context
Durable facts: night shifts, two kids, travels monthly.

## Log
Dated one-liners, newest first: agreements, milestones, notable moments.
```

Rules:
- Sections are a **convention, not a schema** — the design plane may evolve them per client; the runtime consumes the file whole (§4), so structure changes never break the pipeline.
- `## Log` is the append-friendly bottom that keeps the top sections *curated rather than accumulated*; the design-plane narrative workflow (Phase 3) promotes durable Log items upward and prunes.
- Write paths: design-plane sessions and admin-UI quick edits only (D14, D17); both commit to git (D15). The runtime reads fresh per invocation, never caches, never writes.

### 3.2 Prompts (product repo, `prompts/`)

```
prompts/
├── router.md              # intent classification instructions
├── gm_classifier.md       # classification principles
├── gm_classifier_examples.md  # reasoning-memory few-shots (successor to reasoning_memory.json)
├── coach_persona.md       # voice: direct, minimal, no emojis, 1-2 sentences
├── coach_examples.md      # calibration examples
└── coach_system.md        # primary agent instructions + tool guidance
```

Exact contents are Phase 3 scope; the file layout and their audit linkage (`prompt_file_hash`) are fixed here. `PromptStore` returns `{content, gitHash}` per file.

---

## 4. Conversation History as LLM Context

**Deliberate decision: no embeddings, no vector store, no RAG.** At 10–50 clients with text-message-sized exchanges, that stack is complexity without payoff. Three layers, assembled by one `ContextBuilder` used by every coach-agent invocation:

1. **Narrative file, verbatim and whole** — the long-term memory, pre-compressed by the operator/design plane. This is the narrative's architectural job: it replaces summarization pipelines and vector search.
2. **Recent conversation, verbatim** — last **30 messages or 14 days, whichever is smaller** (operator-approved defaults; config constants), both directions, oldest-first, timestamped, operator-sent replies included.
3. **Compliance summary, computed** — current streak, last-7-day pattern, today's status. Cheap SQL rendered as a compact block.

Deeper history is **pulled, not pushed**: the primary agent's `get_recent_conversation` tool accepts paging beyond the default window (tool schema in Phase 3). The router and GM classifier get layer 3 plus the batch text only — they never need the narrative.

---

## 5. Storage Abstraction (Repository Layer)

Repository-per-aggregate, spanning both media so callers never know where data lives. Interfaces (signatures indicative; exact TypeScript is Phase 5):

| Repository | Backing | Responsibility |
|---|---|---|
| `ClientRepo` | SQLite | CRUD, lifecycle transitions, verification; **reset** and **delete** as single transactions (D11) with audit events |
| `MessageRepo` | SQLite | Append messages, manage batches/debounce state, unanswered-span queries |
| `ComplianceRepo` | SQLite | **Sole writer of `compliance_days`** — the state machine lives behind this interface; day resolution, reconciliation walk, streak derivation, operator corrections (audited) |
| `DraftRepo` | SQLite | Draft lifecycle, one-active enforcement, transactional send with freshness check (D19) |
| `NarrativeStore` | Files + SQLite | Read narrative content; watermark + flags via `narrative_meta`/`narrative_flags`; staleness score; quick-edit write path (git commit) |
| `PromptStore` | Files (read-only at runtime) | Prompt content + git hash for audit |
| `AuditRepo` | SQLite | `llm_calls` + `audit_events` append; admin-UI query surface |

Rules:
- All SQLite access via repositories; no inline SQL elsewhere. Multi-step operations (batch processing, send, reset/delete, reconciliation) are better-sqlite3 transactions.
- Repositories expose **domain operations** (`resolveDay`, `markStale`), not row CRUD — the Postgres path (D2) and testability both depend on the interface being behavioral.
- Design-plane read access (Phase 1 §2.9) queries the same SQLite file read-only; it does not go through the runtime process.

## 6. Access Patterns (hot queries the schema must serve)

| Surface | Query shape |
|---|---|
| Triage: awaiting response | processed batches, `needs_response=1`, `dismissed_at` NULL, no covering non-stale draft — join `batches`→`drafts` |
| Triage: miss follow-ups | `compliance_days WHERE followup_state='pending'` |
| Triage: pending drafts | `drafts WHERE status='draft'` |
| Triage: unverified contacts | `clients WHERE status='pending_verification'` |
| Triage: narrative staleness | flags + reply-worthy batches since `watermark_ts`, per client, vs threshold |
| Client detail: conversation | `messages` by client, time-desc, paged |
| Client detail: compliance calendar | `compliance_days` by client, date range |
| Send freshness check | newest inbound `message.id` vs `covers_through_message_id` (in-transaction) |
| Reconciler | `clients WHERE last_reconciled_date < today(client tz)`, then per-day walk |
| Context builder | narrative file + last-30/14d messages + streak derivation |
| Design plane: calibration | `drafts` where `final_text` ≠ `draft_text`, or status `rejected`, per client/period |

All served by the indexes defined in §2 at 50-client scale without further tuning.

## 7. Fresh-Start Bootstrap (D22 — replaces migration)

The prototype is retired; nothing is imported. Bootstrap is:

1. `migrations/001_init.sql` creates the schema (§2) on first boot; `schema_migrations` records it.
2. `prompts/` files are authored in Phase 3 (the classifier prompt will be *informed by* the prototype's `suggestion-prompt.md` and accumulated `reasoning_memory.json` as reference material, but nothing is mechanically imported).
3. The narratives directory is initialized empty as its own private git repo.
4. Clients — including the current live client — onboard through the front door: they message the bot → `pending_verification` → operator verifies → active. Day 1 of compliance history is their first day on the new system; streaks start at zero by design.
5. The prototype's `data/` JSON stays untouched on disk as a frozen archive (reference for the design plane when authoring the live client's initial narrative — authored conversationally, not imported).

One consequence to state plainly: **the live client's streak and history do not carry over.** If that matters coaching-wise, it's handled in the narrative ("long-standing client, consistent GM habit since May") rather than in compliance data.

## 8. Extension Pattern (future domains)

New coaching domains (nutrition, training, metrics — Phase 1 §7) add: new tables (e.g. `body_metrics`), a new repository, new tools, and prompt files. They never alter existing tables — cross-domain reads happen at the tool layer, keeping "lean data, extend later" true structurally.

---

## 9. Phase 2 Decision Record

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| P2-1 | Narrative sections | Snapshot / Current Focus / Obstacles / What Works / Life Context / Log | Operator confirmed (2026-07-07) this matches his coaching mental model; convention not schema |
| P2-2 | Context strategy | Narrative + last 30 msgs/14 days verbatim + computed compliance block; no RAG/embeddings | Operator confirmed defaults; complexity without payoff at ≤50 clients; narrative is the compression |
| P2-3 | Fresh start | No migration; prototype retired; archive kept as design-plane reference | Operator decision (2026-07-07) = D22; streak history handled narratively, not imported |
| P2-4 | Streak storage | Derived from `compliance_days.streak_after`, never stored on `clients` | Single source of truth; recomputable by replay |
| P2-5 | Batch as first-class row | `batches` table with `open→pending→processed` lifecycle | Debounce survives restarts; the router's unit of work; anchors triage |
| P2-6 | One-active-draft enforcement | Partial unique index, freshness check inside send transaction | D19 invariants enforced by the database, not by application discipline |
| P2-7 | Schema migrations | Forward-only numbered SQL files + `schema_migrations` | Rollback = DB snapshot (consistent with D20 tooling); no down-migration complexity |
| P2-8 | Router output shape | `primary_intent` + `router_confidence` + `needs_response`; no GM-detection field — GM detection belongs solely to the classifier (D23) | Operator decision (2026-07-07): the router and classifier answer orthogonal questions (what response? / did they check in?); a router pre-gate on the classifier would duplicate the GM judgment and risk false Misses. Handles mixed bursts ("GM" + a question) with both paths served |

## 10. Deferred

- **Phase 3:** prompt file contents; tool schemas (incl. `get_recent_conversation` paging, `flag_for_narrative`); router intent taxonomy refinement; design-plane workflow specs and their read-only SQLite tooling; staleness threshold defaults.
- **Phase 4:** build order; testing strategy (state-machine replay tests, snapshot/restore harness); config surface (debounce window, context window, thresholds).
- **Future domains:** per §8, additive only.
