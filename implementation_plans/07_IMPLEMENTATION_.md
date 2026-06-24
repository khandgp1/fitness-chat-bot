# Phase 8 — Batch Processing Cadence & Single-Client Daily Compliance

> **Plan Index:** 07
> **Goal:** Replace the per-message-immediate pipeline with a 30-minute batched pipeline for GM verification, and replace the hourly midnight cron with a single daily 00:01 compliance check scoped to the one configured client.
> **Exit Criteria:** Messages are queued in-memory; the batch fires once per 30-minute window; only compliance state is updated (no reply is sent); the 00:01 cron transitions the client's day without the hourly loop; existing tests still pass.

---

## Tech Decisions (Aligned via /grill-me)

| Decision                   | Choice                                                                              | Rationale                                                               |
| :------------------------- | :---------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| **Batch trigger**          | First unprocessed message starts a 30-minute timer                                  | Simple event-driven window; no fixed-slot drift                         |
| **Batch GM detection**     | Concatenate all queued messages into one string, send to existing `classifyMessage` | Single LLM call per window; any valid GM in the batch counts            |
| **Batch storage**          | In-memory `Map<userId, string[]>` + `Map<userId, NodeJS.Timeout>`                   | No schema changes; acceptable to drop a window on restart               |
| **Reply after batch**      | No reply — silent compliance state update only                                      | Decouples response UX from the delayed batch                            |
| **New-day compliance**     | Daily cron at `00:01` (replaces hourly scan)                                        | Deterministic, no longer dependent on a message arriving                |
| **Single-client identity** | `BOT_CLIENT_ID` env var                                                             | Already consistent with env-config pattern in this repo                 |
| **Tests**                  | Leave existing tests untouched                                                      | Pure-function signatures unchanged; batch logic not unit-tested for now |

---

## Proposed Changes

### Configuration

#### [MODIFY] .env.example

- Add `BOT_CLIENT_ID=your_client_id_here` (used by the 00:01 scheduler).

#### [MODIFY] .env

- Add `BOT_CLIENT_ID=<actual client id>` matching the real client's JSON filename.

---

### Bot HTTP Server

#### [MODIFY] src/bot/bot.ts

**Remove** the immediate per-message pipeline (steps 2–7 of the current async IIFE).

**Add** two module-level Maps:

```ts
const messageQueues = new Map<string, string[]>(); // userId → queued messages
const batchTimers = new Map<string, NodeJS.Timeout>(); // userId → active timer handle
```

**New `/webhook` flow:**

1. Validate `userId` + `message` as today.
2. Respond `200 OK`.
3. Push `message` into `messageQueues.get(userId)` (create array if first).
4. If no timer is running for this `userId`, start a `setTimeout` of 30 minutes that calls `processBatch(userId)`.

**New `processBatch(userId)` function:**

1. Pop the full queue from `messageQueues` (clear it).
2. Delete the timer handle from `batchTimers`.
3. Ensure client exists (create if not).
4. `loadClient(userId)` — catches up days.
5. Concatenate all queued messages with `\n` separator.
6. Call `classifyMessage(concatenatedMessages)`.
7. Call `handleGmResult(state, result, concatenatedMessages)`.
8. `saveClient(updatedState)`.
9. Log the pipeline result (no reply sent).

---

### Midnight Scheduler

#### [MODIFY] src/scheduler/midnight.ts

**Remove** the hourly cron (`0 * * * *`) and the full-directory scan loop.

**Add** a daily cron at `1 0 * * *` (00:01 every night) that:

1. Reads `process.env.BOT_CLIENT_ID`.
2. Calls `loadClient(clientId)` — which internally calls `transitionClientDays` and auto-saves if the day changed.
3. Logs the result.

---

## Progress Checklist

- [ ] Add `BOT_CLIENT_ID` to `.env.example` and `.env`
- [ ] Rewrite `src/bot/bot.ts`:
  - [ ] Add `messageQueues` and `batchTimers` module-level Maps
  - [ ] Replace immediate pipeline with queue-push + conditional timer start
  - [ ] Implement `processBatch(userId)` function (classify → compliance → save, no reply)
- [ ] Rewrite `src/scheduler/midnight.ts`:
  - [ ] Replace hourly cron with daily `1 0 * * *` cron
  - [ ] Replace directory scan with single `loadClient(BOT_CLIENT_ID)` call
- [ ] Run `npm run build` to verify compile-time safety
- [ ] Run `npx tsx src/compliance/testCompliance.ts` and `npx tsx src/state/testStore.ts` to confirm no regressions
