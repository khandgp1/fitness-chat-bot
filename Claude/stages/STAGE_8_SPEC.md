# Stage 8 — Hardening & Go-Live

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 8
**Goal:** The system becomes trustworthy enough to carry the real client: backups, health visibility, the missing unblock action — then the operator-paced shakedown week and the cutover that retires the prototype. This stage has **two checkpoints**: a code checkpoint (tasks below) and the go-live itself (runbook-driven, on your schedule).

---

## Design Notes

- **Unblock (operator-found gap, Stage 7):** `ClientRepo.unblock` — blocked → `active` if the client was ever verified, else back to `pending_verification`; audited; API route + UI button on blocked rows.
- **Nightly backup (`src/ops/backup.ts`):** once per calendar day, the 15-min tick copies a WAL-checkpointed DB + the narratives directory to `data/backups/<YYYY-MM-DD>/`; keeps the newest 14, prunes older. Same second-connection checkpoint technique as D20 snapshots — safe while the app runs. Named by effective-clock date (dev sims may produce extra backups; harmless).
- **Health visibility (`GET /api/health` + UI banner):** the error-surfacing pass, kept honest and small. Every failure path already lands somewhere durable (llm_calls.error, pending batches, boot refusals); health makes the symptoms visible in one place: pending-batch count + oldest age, LLM errors in the last 24h, last backup date, dev-snapshot presence, last reconcile sweep. The UI polls it and shows a warning banner when something's off — no new failure handling, just eyes on what exists.
- **`Claude/GO_LIVE.md` runbook** — the operational half of the stage, executed by you at your pace:
  1. **Pre-flight:** `.env` complete; `npm test` green; UI reachable; backup ran.
  2. **Shakedown week:** you as a fake client (dev-panel or a second Telegram account), daily real use of both planes; anything found comes back here as fixes.
  3. **Cutover (an evening, after the day's check-in):** stop the prototype → set the production bot token in v2 `.env` → `npm start` → client's next message auto-registers him → verify in the UI → same day, `/narrative-update` to author his initial narrative (prototype's `data/` archive as reference — D22) → watch the first GM classify.
  4. **Rollback path:** prototype stays runnable untouched for a week — swap the token back if anything's wrong.
  5. **Retirement (after a stable week):** prototype `src/` → `legacy/`, its `data/` stays frozen as the reference archive (P4-1 completes).
- **`CLAUDE.md` update (operator-owned file — applied with this spec's approval):** the architect-protocol content remains, plus a short section routing future sessions: coaching ops → the three skills; runtime work → `v2/` + stage specs; the phase docs as the decision record.

## File List

```
v2/src/ops/backup.ts             # backupNow + shouldBackup + prune (14)
v2/src/repos/clientRepo.ts       # UPDATED: unblock
v2/src/server/api.ts             # UPDATED: /api/health, /api/clients/:id/unblock
v2/src/app.ts                    # UPDATED: tick runs the daily backup
v2/admin-ui/src/App.tsx          # UPDATED: health banner
v2/admin-ui/src/views/Clients.tsx# UPDATED: Unblock button
Claude/GO_LIVE.md                # the runbook
CLAUDE.md                        # UPDATED: session routing section
v2/test/ops.test.ts              # backup + health + unblock
```

## Tasks

- [x] **1. Unblock** — repo transition + route + UI button.
  *AC: all four cases green (active-return, gate-return, refusal, HTTP round-trip; audited with target status).* ✅
- [x] **2. Nightly backup + retention** — dated directory with DB + narratives; once per day via tick; prune to 14.
  *AC: consistent copy proven by opening the copied DB; same-day idempotence; next-day re-run; prune + latest; missing narratives tolerated.* ✅ 4 tests
- [x] **3. Health endpoint + UI banner** — as designed.
  *AC: healthy baseline empty; stale-pending + LLM-error warnings surface.* ✅ 2 tests
- [x] **4. GO_LIVE.md + CLAUDE.md routing section.** — 5-phase runbook (pre-flight → shakedown → cutover → stability/rollback → retirement); CLAUDE.md gains §0 Session Routing, architect protocol intact. ✅
- [x] **5. Suite green (137), typecheck clean, UI rebuilt.** ✅

**Code checkpoint complete.** Go-live checkpoint remains with the operator per `Claude/GO_LIVE.md`.

## Verify

**Code checkpoint (now):** restart `npm start` → health shows green in the UI → block+unblock a client round-trips → `data/backups/<today>/` appears after the next tick (or immediately via the dev panel's clock advance) → `npm test` green.

**Go-live checkpoint (yours, runbook-paced):** shakedown week → cutover evening → the live client's first GM classifies on v2 → a stable week → prototype retired. That closes Stage 8, Phase 5, and the redesign.
