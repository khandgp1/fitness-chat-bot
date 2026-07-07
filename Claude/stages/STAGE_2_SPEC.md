# Stage 2 — Compliance Engine

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 2
**Goal:** The compliance state machine and reconciler as pure, replay-tested domain logic behind `ComplianceRepo`, plus the snapshot/restore dev tooling (D20). No Telegram, no LLM, no UI — events enter the engine as function calls; Stage 4 wires the classifier to them.

---

## Design Notes

**The engine is the sole writer.** `src/domain/compliance.ts` exports `createComplianceEngine(...)`; it is the only code that calls `ComplianceRepo.upsertDay` (sole-writer discipline, Phase 2 §5 — enforced by convention and review, stated in both files' headers).

**State machine (from the approved domain spec):**

```
unknown         → compliant        valid GM today (client tz)
unknown         → pending_review   classification failure today
unknown         → miss             day closes with neither (reconciler)
pending_review  → compliant        valid GM later the same day
pending_review  → (held)           day closes unresolved — holds indefinitely
compliant       → compliant        duplicate GM: no-op, no double increment
```

Streaks: `compliant` day = streak-before-that-date + 1; `miss` = 0; `pending_review` = NULL (hold). *Streak-before* skips NULL days, so a held day is transparent: if day D is held and D+1 is compliant, D+1's streak builds on D−1's. Invalid-GM classifications (`is_valid_gm=false`) change nothing — the day just stays `unknown`.

**Reconcile-on-touch.** `recordValidGm` and `recordClassificationFailure` internally reconcile the client first, so streak math is always computed against a closed history — a GM arriving right after three days of downtime gets the correct post-miss streak with no ordering discipline required of callers. The scheduler and boot path also call `reconcileAll()` (Stage 3+ wiring).

**Reconciler walk:** for each active client, close every unresolved day from `last_reconciled_date + 1` through *yesterday* (today is never closed — the day isn't over): no row / `unknown` → `miss` with `streak_after = 0` **and `followup_state = 'pending'`** (P3-2); `pending_review` → left held; then advance `last_reconciled_date`. **Verification-day grace:** a new client's baseline is their verification date, so the first day that can be closed as a miss is their first *full* day; a GM on verification day still counts as compliant normally.

**Backward time (D20):** if effective yesterday < `last_reconciled_date`, the reconciler logs a warning, writes a `reconcile_backward_time_refused` audit event, and does nothing. It never un-marks days.

**Operator corrections get a primitive now, a UI later (Stage 6):** `correctDay(clientId, date, 'compliant' | 'miss', actor)` resolves any past day (including held pending-reviews) and **recomputes `streak_after` forward** from that date across all resolved days — corrections can't leave stale streak math downstream. Audited.

**Snapshot/restore (D20):** `src/dev/snapshot.ts` — file-level copy of the DB (after a WAL checkpoint) plus the clock sidecar, to `<dbPath>.snapshot/`. Clock CLI integration: the **first** `advance-*` while no snapshot exists takes one automatically; `reset` restores DB + clock together and deletes the snapshot (if none exists, it just resets the offset as today). Simulated days don't get "undone" — they never happened.

## File List

```
v2/src/domain/compliance.ts      # engine: state machine + reconciler + corrections
v2/src/dev/snapshot.ts           # snapshot/restore (DB file + clock sidecar)
v2/src/cli/clock.ts              # UPDATED: auto-snapshot on first advance; restore on reset
v2/src/cli/stage2-sim.ts         # Verify walkthrough: a simulated month
v2/test/compliance.test.ts       # table-driven replay suite (the heart)
v2/test/snapshot.test.ts
```

## Key Interfaces

```ts
interface ComplianceEngine {
  recordValidGm(clientId: string, messageId?: string): ComplianceDay;      // today; reconciles first
  recordClassificationFailure(clientId: string): ComplianceDay;            // today → pending_review unless compliant
  reconcile(clientId: string): { closed: ComplianceDay[]; upTo: string };  // forward-only, idempotent
  reconcileAll(): { clients: number; closed: number };                     // all active clients
  correctDay(clientId: string, date: string, status: 'compliant' | 'miss',
             actor: 'operator'): void;                                     // + forward streak recompute + audit
}
function createComplianceEngine(deps: {
  db: Db; clock: Clock;
  clients: ClientRepo; compliance: ComplianceRepo; audit: AuditRepo;
}): ComplianceEngine;

// dev/snapshot.ts
function snapshotExists(dbPath: string): boolean;
function takeSnapshot(dbPath: string): void;      // WAL checkpoint, then copy db + clock sidecar
function restoreSnapshot(dbPath: string): void;   // copy back, remove snapshot; caller must not hold the DB open
```

## Tasks

- [x] **1. Same-day transitions** — `recordValidGm` / `recordClassificationFailure`, streak-before computation, duplicate-GM no-op, pending→compliant same-day resolution. *(Interface addition: `ComplianceRepo.streakBefore` — the query home for "streak as of before date".)*
  *AC (replay): 3 GMs → streak 3 · GM/miss/GM → 1,0,1 · duplicate GM increments once · failure→pending, later GM→compliant same day.* ✅
- [x] **2. Reconciler** — closure walk with verification-day baseline, miss closure with `followup_state='pending'`, held pending days, backward-time refusal, idempotency, transactional per-client walk.
  *AC (replay): 3-day downtime → 3 misses + followups on next touch · held pending day is transparent to later streaks · backward clock → no-op + audit event · double reconcile closes nothing · verification day itself never closed as miss.* ✅
- [x] **3. Corrections** — `correctDay` with forward streak recompute.
  *AC (replay): held pending day corrected to compliant → its streak and every later resolved day's streak recomputed correctly; correction audited; future corrections refused.* ✅
- [x] **4. Snapshot/restore module** — WAL-checkpointed file copy + clock sidecar, both directions.
  *AC: test — seed DB → snapshot → mutate rows + advance clock → restore → DB rows and offset match the snapshot moment; snapshot consumed.* ✅
- [x] **5. Clock CLI integration** — auto-snapshot on first `advance-*`, restore-and-delete on `reset`; `status` shows whether a snapshot exists.
  *AC: manual — advance (snapshot appears) → ghost row inserted mid-sim → reset → ghost row gone, offset +0h, snapshot consumed.* ✅ verified
- [x] **6. Simulation CLI (`stage2-sim.ts`)** — scripted month for the Verify checkpoint, with mid-sim process restart.
  *AC: output calendar matches hand-computed expectations for the scripted month.* ✅ *(One sim-script bug found during build: day labels were off by one because the first action ran before any clock advance — script fixed; the engine itself was correct.)*

**Stage complete:** 63 tests green (18 new: 15 compliance replay + 3 snapshot), typecheck clean. Awaiting operator Verify checkpoint.

## Verify (operator checkpoint)

From `v2/`: `npm test` green (Stage 0+1's 45 + this stage's suites) → `npx tsx src/cli/stage2-sim.ts` prints a month-long compliance calendar you can eyeball against the rules (misses reset, pendings hold, downtime closes misses retroactively) → then the manual snapshot loop: `npm run clock -- advance-day` (snapshot auto-taken) → run the sim again → `npm run clock -- reset` → confirm the DB is back to its pre-simulation state.
