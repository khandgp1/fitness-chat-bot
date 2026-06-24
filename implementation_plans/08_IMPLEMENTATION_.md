# 08 — Hourly Batch Processing Cron

## Overview

Replace the current one-shot 30-minute `setTimeout` batch timer with a **fixed hourly cron job** (`0 * * * *`) that drains any pending message queues at the top of every hour.

The hourly cron also absorbs the responsibility of the existing **midnight scheduler** (`midnight.ts`), which is removed. At the midnight tick (12:00 AM), the cron flushes any pending batch first, then runs the compliance day-transition check via `loadClient`.

**Timestamp anchoring** is added to fix the midnight edge case: the bot snapshots the time of the first message in a batch and passes it as the effective date through the processing pipeline, so late-night messages are always credited to the correct calendar day regardless of when the cron fires.

---

## Design Decisions (resolved via grill-me)

| Decision                                    | Choice                                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| Effective date for a batch                  | Snapshot timestamp of **first message** in batch          |
| Midnight scheduler                          | **Replaced** by the hourly cron (no separate midnight.ts) |
| Empty-queue behaviour on non-midnight hours | **No-op** — skip compliance check                         |
| Compliance check timing                     | **Only at midnight tick** (12:00 AM hour)                 |
| New scheduler location                      | `src/scheduler/hourly.ts` (new file)                      |
| Cross-module coupling                       | Export `flushPendingBatch(userId)` from `bot.ts`          |
| `BATCH_WINDOW_MS` env var                   | **Removed** from `.env` and `.env.example`                |

---

## Proposed Changes

### `src/bot/bot.ts`

- **Remove** `BATCH_WINDOW_MS` constant and all `setTimeout` / `batchTimers` logic.
- **Add** `batchStartTimestamps: Map<string, string>` to store the ISO timestamp of the first message for each active batch.
- **Update** webhook handler: when a new queue is created for a userId, record `new Date().toISOString()` as the batch start timestamp.
- **Update** `processBatch` to accept an optional `anchoredTimestamp` and thread it through to `loadClient` and `handleGmResult`.
- **Add** and export `flushPendingBatch(userId: string): Promise<void>`:
  - Reads and clears the anchored timestamp.
  - Calls `processBatch(userId, anchoredTimestamp)`.

```ts
// New map alongside messageQueues
const batchStartTimestamps = new Map<string, string>();

// In webhook handler — when starting a new queue:
if (!messageQueues.has(userId)) {
  messageQueues.set(userId, []);
  batchStartTimestamps.set(userId, new Date().toISOString()); // anchor
}

// New exported function
export async function flushPendingBatch(userId: string): Promise<void> {
  const anchoredTimestamp = batchStartTimestamps.get(userId);
  batchStartTimestamps.delete(userId);
  await processBatch(userId, anchoredTimestamp);
}
```

---

### `src/scheduler/hourly.ts` [NEW]

- Schedules a cron at `0 * * * *` (top of every hour).
- On each tick:
  1. Reads `BOT_CLIENT_ID` from env.
  2. Calls `flushPendingBatch(clientId)` — no-op if queue is empty.
  3. **Only if the current hour is midnight (hour === 0):** calls `loadClient(clientId)` to run the compliance day-transition check.
- Exports `startHourlyScheduler(): ScheduledTask`.

```ts
cron.schedule('0 * * * *', async () => {
  const clientId = process.env.BOT_CLIENT_ID;
  if (!clientId) return;

  // Always flush any pending batch first
  await flushPendingBatch(clientId);

  // Only run compliance check at midnight
  const isMidnight = new Date().getHours() === 0;
  if (isMidnight) {
    loadClient(clientId);
  }
});
```

---

### `src/scheduler/midnight.ts` [DELETE]

Removed entirely. Responsibility absorbed by `hourly.ts`.

---

### `src/index.ts`

- Remove import of `startMidnightScheduler` and its call.
- Add import of `startHourlyScheduler` from `./scheduler/hourly.js`.
- Call `startHourlyScheduler()` in place of `startMidnightScheduler()`.

---

### `.env` / `.env.example`

- Remove the `BATCH_WINDOW_MS` line (if present).

---

## Verification Plan

### Build Check

- `npm run build` — TypeScript compilation must pass with no errors.
- Confirm no remaining references to `BATCH_WINDOW_MS`, `batchTimers`, or `startMidnightScheduler`.

### Scenario Table

| Scenario                                            | Expected Result                                               |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Message arrives at 11:45 PM, cron fires at 12:00 AM | Batch anchored to 11:45 PM date; credited to correct night    |
| Message arrives, cron fires same hour               | GM evaluated and state saved correctly                        |
| No messages pending at non-midnight hour tick       | Cron is a no-op                                               |
| Midnight tick with no pending messages              | No batch flush; compliance check runs via `loadClient`        |
| Midnight tick with pending messages                 | Batch flushed first (with anchor), then compliance check runs |

---

## Progress Checklist

- [x] Modify `src/bot/bot.ts`: remove timer logic, add timestamp anchor map, add `flushPendingBatch` export
- [x] Create `src/scheduler/hourly.ts` with hourly cron
- [x] Delete `src/scheduler/midnight.ts`
- [x] Update `src/index.ts`: swap scheduler import and startup call
- [x] Remove `BATCH_WINDOW_MS` from `.env` and `.env.example` (was never present — already clean)
- [x] Run `npm run build` and verify clean compile
- [x] Verify no stale references to removed symbols
