# Stage 7 — Design Plane

**Status:** Spec presented for operator review *(Stage 6 closed conditionally — operator defers deeper UI testing to this stage's Verify)*
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 7
**Goal:** The operator's CLI studio becomes real: the private narratives repo, the read-only query surface the meta-agent uses, the audited watermark bookkeeping write, and the three workflows (`/narrative-update`, `/assess`, `/tune-prompts`) as project skills. Ends with a narrative authored conversationally, committed, and the staleness nudge clearing in the UI.

---

## Design Notes

- **D16 bug found while spec'ing: the `NARRATIVES_DIR` default (`../fitness-bot-narratives`, relative to `v2/`) resolves *inside* the main repo** — client data could ride along in a pushable repo. Fix: default becomes `../../fitness-bot-narratives` (a sibling of `fitness-chat-bot/`), an `init` command creates it with its own git repo + README, and any existing in-repo directory is migrated. A root `.gitignore` entry is added as a safety net.
- **The studio CLI is the meta-agent's tool surface** (`npm run studio -- …`), split by the Phase 1 §2.9 discipline:
  - **Reads open the DB with `{ readonly: true }`** — writes are impossible by construction, not convention. `context <client>` (narrative + watermark + uncleared flags + compliance + conversation-since-watermark + the calibration record: draft-vs-final diffs, rejections, dismissals), `calibration [--client]` (cross-client aggregates for prompt tuning), `clients` (roster + staleness).
  - **`resolve <client>` is the design plane's only DB write:** advance the watermark, clear covered flags, write an audit event — one transaction, actor `operator`. (D18: watermark advances on resolution, including the "nothing durable" outcome.)
- **Skills live at the repo root** (`.claude/skills/<name>/SKILL.md`) so any Claude Code session here can run them; shared operating rules (read-only discipline, commit conventions, privacy: client data never leaves the narratives dir, prompt edits state their evidence) live once in `Claude/STUDIO.md` and each skill points to it. The existing `CLAUDE.md` (architect persona) is left untouched — Stage 8 revisits it at go-live.
- **Workflow shape per Phase 3 §7:** command → pre-pulled context (via studio CLI) → conversation → file edits → git commit (narratives repo for client files, main repo for `v2/prompts/*`) → `resolve` bookkeeping. Direct writes, versioned (D15) — the operator is present; git is the audit trail.

## File List

```
v2/src/cli/studio.ts             # init | clients | context <id> | calibration | resolve <id>
v2/src/config/config.ts          # UPDATED: NARRATIVES_DIR default outside the repo
.claude/skills/narrative-update/SKILL.md
.claude/skills/assess/SKILL.md
.claude/skills/tune-prompts/SKILL.md
Claude/STUDIO.md                 # shared studio rules (referenced by all three skills)
.gitignore                       # UPDATED: safety net for any in-repo narratives dir
v2/test/studio.test.ts
```

## Tasks

- [ ] **1. D16 fix + `studio init`** — new default, init command (dir + git init + README), migration of an existing in-repo dir, root `.gitignore` net.
  *AC: fresh init produces a git repo outside the main repo; config test updated.*
- [ ] **2. Studio reads** — `context`, `calibration`, `clients` on a read-only connection.
  *AC: test — a write attempt through the read connection throws (SQLITE_READONLY); context output contains narrative, flags, conversation-since-watermark, and calibration lines.*
- [ ] **3. Studio `resolve`** — watermark + flag clear + audit in one transaction.
  *AC: test — watermark advances, only covered flags clear, audit event `narrative_resolved` written; partial failure leaves nothing half-done.*
- [ ] **4. Skills + STUDIO.md** — the three workflows with pre-pull commands, conversation guidance, edit/commit/resolve steps.
  *AC: skill files well-formed; reviewed at Verify by actually running one.*
- [ ] **5. Tests green** across the suite.

## Verify (operator checkpoint)

1. `npm run studio -- init` (one-time), then — in a **new Claude Code session** at the repo root — run **`/narrative-update <your dev client>`**: the session pulls context, interviews you briefly, writes the narrative file, commits in the narratives repo, and resolves the watermark.
2. In the admin UI: the client's staleness badge clears; the narrative renders in the client detail view; the next coach draft visibly uses it.
3. Optionally run `/assess` on the same client to see the deeper workflow.
4. Plus your deferred Stage 6 UI testing, now with a real narrative in play.
