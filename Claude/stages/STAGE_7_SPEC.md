# Stage 7 — Design Plane

**Status:** Spec presented for operator review *(Stage 6 closed conditionally — operator defers deeper UI testing to this stage's Verify)*
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 7
**Goal:** The operator's CLI studio becomes real: the narratives store in its final form, the read-only query surface the meta-agent uses, the audited watermark bookkeeping write, and the three workflows (`/narrative-update`, `/assess`, `/tune-prompts`) as project skills. Ends with a narrative authored conversationally and the staleness nudge clearing in the UI.

---

## Design Notes

- **Narrative storage — D15/D16 revised by operator (2026-07-08), superseding the earlier nested-git design:**
  - **Location:** `v2/data/narratives/` — beside the SQLite file, covered by the *existing* `v2/.gitignore` `data/` entry. One mental model: everything under `v2/data/` is client data, never tracked, backed up as a unit. Config default `NARRATIVES_DIR` becomes `data/narratives`.
  - **No git.** Narratives are *derivative* — compressions of conversation history that lives permanently in SQLite — so history isn't needed for data safety, and the nested repo's costs (git exec on every write, identity config, tooling confusion, `filter-repo` erasure ceremony) buy nothing the system reads. `NarrativeStore.quickEdit` drops its git plumbing.
  - **Daily pre-image snapshots (Option A):** on the *first write of a day* (effective/dev clock date), the previous content is copied to `data/narratives/history/<clientId>/<YYYY-MM-DD>.md`; later writes that day skip. Rollback point = "the narrative as it stood at the start of any day you touched it." Coalesces iteration noise; filenames self-describe; growth is trivial (KB-scale files).
  - **Audit:** `audit_events` rows (quick-edits, resolves) are the queryable trail — git's role as the narrative audit ends. Prompts are unaffected: they stay in the main repo with git history and blob-hash linking.
  - The Phase 1 D15/D16 rows get revision notes when this stage is built.
- **Client data erasure procedure** (documented in `Claude/STUDIO.md`) — now simpler without git: (1) app-level delete (D11 cascade), (2) `rm data/narratives/<clientId>.md` and `rm -r data/narratives/history/<clientId>/`, (3) the honest residuals: `llm_calls.result` / audit details and any file-system backups need a manual scrub for a true erasure request. Manual procedure only; no automation until the need is real.
- **The studio CLI is the meta-agent's tool surface** (`npm run studio -- …`), split by the Phase 1 §2.9 discipline:
  - **Reads open the DB with `{ readonly: true }`** — writes impossible by construction. `context <client>` (narrative + watermark + uncleared flags + compliance + conversation-since-watermark + the calibration record: draft-vs-final diffs, rejections, dismissals), `calibration [--client]` (cross-client aggregates for prompt tuning), `clients` (roster + staleness).
  - **`resolve <client>` is the design plane's only DB write:** advance the watermark, clear covered flags, write an audit event — one transaction, actor `operator`. (D18: watermark advances on resolution, including the "nothing durable" outcome.)
- **Skills live at the repo root** (`.claude/skills/<name>/SKILL.md`) so any Claude Code session here can run them; shared operating rules (read-only discipline, privacy: client data never leaves `v2/data/`, prompt edits state their evidence and are committed to the main repo) live once in `Claude/STUDIO.md`. The existing `CLAUDE.md` (architect persona) is left untouched — Stage 8 revisits it at go-live.
- **Workflow shape per Phase 3 §7:** command → pre-pulled context (via studio CLI) → conversation → file edits (narrative files written directly; `v2/prompts/*` edits committed to the main repo) → `resolve` bookkeeping. Direct writes (D15); the operator is present.

## File List

```
v2/src/cli/studio.ts             # init | clients | context <id> | calibration | resolve <id>
v2/src/repos/narrativeStore.ts   # UPDATED: git plumbing removed; daily pre-image snapshot on write
v2/src/config/config.ts          # UPDATED: NARRATIVES_DIR default → data/narratives
.claude/skills/narrative-update/SKILL.md
.claude/skills/assess/SKILL.md
.claude/skills/tune-prompts/SKILL.md
Claude/STUDIO.md                 # shared studio rules + erasure procedure
v2/test/studio.test.ts
v2/test/narrativeStore.test.ts   # UPDATED: git assertions → snapshot assertions
```

## Tasks

- [x] **1. Narrative store revision (D15/D16 revised) + `studio init`** — default → `data/narratives`, git plumbing removed, daily pre-image snapshots (exposed as `snapshotDaily` so the skills can guard direct file edits — spec addition); Phase 1 D15/D16 rows amended; no old-location files existed to migrate.
  *AC: all snapshot-coalescing cases green; no `.git` anywhere in the narrative path; `git check-ignore` confirms coverage (via the existing `v2/.gitignore` `data/` entry — no root entry needed).* ✅ 5 tests
- [x] **2. Studio reads** — `context`, `calibration`, `clients` on `openDbReadOnly`; plus a `snapshot <id>` subcommand (the skills' pre-edit guard).
  *AC: write through the read connection throws; context contains narrative/flags/compliance/conversation-since-watermark/calibration; watermark filters the conversation.* ✅ 4 tests
- [x] **3. Studio `resolve`** — watermark + flag clear + audit in one transaction.
  *AC: green, including unknown-client leaving nothing behind.* ✅ 2 tests
- [x] **4. Skills + STUDIO.md** — three skills at `.claude/skills/`, shared rules + erasure procedure in `Claude/STUDIO.md` (incl. the `mode=ro` convention for ad-hoc SQL).
  *AC: reviewed at Verify by running `/narrative-update` in a fresh session (skills register at session start).* ✅ files in place
- [x] **5. Tests green** — 127 passing, typecheck clean. ✅

**Stage complete.** Awaiting operator Verify checkpoint. *(Note: the dev client was left `blocked` by Stage 6 UI testing — unblock it first via the DB or use a fresh simulated client.)*

## Verify (operator checkpoint)

1. `npm run studio -- init` (one-time), then — in a **new Claude Code session** at the repo root — run **`/narrative-update <your dev client>`**: the session pulls context, interviews you briefly, writes the narrative file, and resolves the watermark.
2. In the admin UI: the client's staleness badge clears; the narrative renders in the client detail view; the next coach draft visibly uses it.
3. Edit the narrative twice in one (dev-clock) day, then advance a day and edit again → `data/narratives/history/<clientId>/` holds exactly two dated snapshots.
4. Optionally run `/assess` on the same client to see the deeper workflow.
5. Plus your deferred Stage 6 UI testing, now with a real narrative in play.
