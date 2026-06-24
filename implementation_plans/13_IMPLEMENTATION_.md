# 13 — Flush Pending Batches on +30 Min Advance When Crossing Hour Boundary

## Overview

Currently, the `/dev/advance-30min` route simply advances the dev clock offset and returns — no side effects. The `/dev/advance-day` route, by contrast, flushes pending batches and runs day-transition logic.

This change makes the +30 min advance **simulate what the real hourly cron would do**: if the time jump crosses an hour boundary, flush the pending message batch. If the crossed hour happens to be midnight (hour 0), also run the compliance day-transition check.

---

## Design Decisions (resolved via grill-me)

| Decision | Choice |
|---|---|
| Flush + midnight compliance? | Yes — full hourly-tick simulation including midnight check |
| Multi-boundary handling | Single check — if ANY hour boundary was crossed, fire once |
| Logic location | In the `/dev/advance-30min` route handler in `bot.ts` |
| Dashboard changes | None — existing auto-poll already refreshes state after clock actions |
| API response metadata | Add `crossedHourBoundary` and `triggeredMidnight` fields to response |
| Dashboard note text | Update to mention +30 min can also trigger a flush |

---

## Proposed Changes

### `src/bot/bot.ts`

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

The `/dev/advance-30min` route handler (lines 132–139) will be changed from a synchronous no-op to an async handler that:

1. **Captures the hour _before_ advancing** — `const hourBefore = devNow().getHours()`.
2. **Calls `advance30Min()`** to bump the offset.
3. **Captures the hour _after_ advancing** — `const hourAfter = devNow().getHours()`.
4. **Detects hour crossing** — `const crossedHourBoundary = hourBefore !== hourAfter`.
5. **If crossed**, flushes the pending batch for `BOT_CLIENT_ID` via `flushPendingBatch()`.
6. **If the new hour is 0** (midnight), also calls `loadClient()` to trigger compliance day-transition.
7. **Returns JSON** with the existing fields plus `crossedHourBoundary: boolean` and `triggeredMidnight: boolean`.

```ts
app.post('/dev/advance-30min', async (req: Request, res: Response) => {
  const hourBefore = devNow().getHours();
  advance30Min();
  const hourAfter = devNow().getHours();

  const crossedHourBoundary = hourBefore !== hourAfter;
  let triggeredMidnight = false;

  const clientId = process.env.BOT_CLIENT_ID;
  if (crossedHourBoundary && clientId) {
    try {
      console.log(`[dev] +30min crossed hour boundary (${hourBefore} → ${hourAfter}), flushing pending batch...`);
      await flushPendingBatch(clientId);

      if (hourAfter === 0) {
        console.log(`[dev] Crossed midnight — running compliance day-transition for "${clientId}"`);
        loadClient(clientId, devNow().toISOString());
        triggeredMidnight = true;
      }
    } catch (err) {
      console.error('[dev] Error running post-advance-30min actions:', err);
    }
  }

  res.json({
    success: true,
    offsetMs: getOffsetMs(),
    devTime: devNow().toISOString(),
    crossedHourBoundary,
    triggeredMidnight,
  });
});
```

---

### `src/dev/dashboardHtml.ts`

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)

Update the note text under Developer Controls (line 547) to mention the new behavior:

```
Note: Advancing the day will flush pending batches. Advancing 30 min will also flush pending batches if the time crosses an hour boundary. Resetting client data deletes and re-creates the client state with fresh defaults.
```

---

## Verification Plan

### Build Check
- `npm run build` — TypeScript compilation must pass with no errors.

### Scenario Table

| Scenario | Setup | Action | Expected Result |
|---|---|---|---|
| No hour crossing | Dev clock at e.g. 10:15 | `npm run dev:advance-30min` | Clock → 10:45, `crossedHourBoundary: false`, no flush |
| Hour crossing | Dev clock at e.g. 10:45 | `npm run dev:advance-30min` | Clock → 11:15, `crossedHourBoundary: true`, batch flushed |
| Midnight crossing | Dev clock at e.g. 23:45 | `npm run dev:advance-30min` | Clock → 00:15, `crossedHourBoundary: true`, `triggeredMidnight: true`, compliance check runs |
| No pending batch | Dev clock at 10:45, no queued messages | `npm run dev:advance-30min` | `crossedHourBoundary: true`, flush is a no-op (nothing queued) |
| Pending batch exists | Send message, then advance at 10:45 | `npm run dev:advance-30min` | Batch flushed, state updated, dashboard reflects changes on next poll |
| Dashboard note | Open dashboard | Visual check | Note text mentions +30 min flush behavior |

### Manual Verification
- Start server with `npm run dev`.
- Send a GM message via `/webhook`.
- Check `GET /dev/clock` to confirm current hour.
- If not near an hour boundary, advance to near one (e.g. `npm run dev:advance-30min` a few times).
- Run `npm run dev:advance-30min` at a time that crosses the hour.
- Verify CLI output shows `crossedHourBoundary: true`.
- Check state file / dashboard to confirm batch was processed.

---

## Progress Checklist

- [ ] Update `/dev/advance-30min` route handler in `src/bot/bot.ts` to detect hour crossing and flush
- [ ] Update dashboard note text in `src/dev/dashboardHtml.ts`
- [ ] Run `npm run build` and verify clean compile
- [ ] Manual end-to-end test
