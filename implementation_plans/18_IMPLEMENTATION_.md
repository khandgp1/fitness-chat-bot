# 18 — 5pm Compliance Reply in Dev Clock

## Goal

Make the 5pm local time compliance auto-reply work correctly when using the developer clock simulation endpoints (`/dev/advance-1hour` and `/dev/advance-day`), ensuring parity between simulated clock advancement and real-world scheduled ticks.

## Proposed Changes

### Bot / Webhook Server

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

- Import `getLocalHour` and `select5pmReply` from `../response/fivePmReply.js`.
- Import `logMessage` from `../dev/messageLog.js`.
- Export a new helper function `executeHourlyTick(clientId, now)` to encapsulate all hourly cron behaviors:
  1. Flush pending message batches.
  2. Perform midnight compliance check and day transition.
  3. Perform 5pm compliance reply check and log the response.
- Update `/dev/advance-1hour` to call `executeHourlyTick` with the advanced timestamp.
- Update `/dev/advance-day` to loop 24 times, calling `advance1Hour()` and `executeHourlyTick` sequentially so that both the midnight transition and 5pm replies occur at the correct simulated hours.

---

### Scheduler

#### [MODIFY] [hourly.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/scheduler/hourly.ts)

- Import `executeHourlyTick` from `../bot/bot.js`.
- Remove imports of `flushPendingBatch`, `logMessage`, `getLocalHour`, and `select5pmReply` from `hourly.ts`.
- Simplify the cron task callback to call `await executeHourlyTick(clientId, now)`.

---

## Verification Plan

### Automated Checks
- `npm run build` — TypeScript must compile with zero errors.
- `npm run lint` — no lint violations.

### Manual Verification
1. **Advance 1 Hour (Case 1)**: Send a valid GM, advance clock hour-by-hour until 5pm. Verify `"G"` is logged from `[BOT-5PM]`.
2. **Advance 1 Hour (Case 2)**: Ensure streak > 0. Do NOT send a GM. Advance hour-by-hour until 5pm. Verify `"G. You got this. Keep going"` is logged.
3. **Advance Day**: Start with streak > 0. Do NOT send a GM. Call `/dev/advance-day`. Verify `"G. You got this. Keep going"` was logged at 5pm and the compliance day-transition occurred at midnight.
