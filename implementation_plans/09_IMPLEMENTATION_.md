# 09 — Manual Dev Time Controls (+1 Day / +30 Min)

## Overview

Add developer tooling to manually advance the bot's internal clock by **+1 day** or **+30 minutes** for testing purposes. This allows rapid simulation of day transitions, missed days, streak logic, and hourly cron behavior without waiting for real time to elapse.

The approach introduces a **global in-memory time offset** applied to all `new Date()` calls via a centralized helper. CLI npm scripts send HTTP requests to lightweight dev routes on the running Express server to advance the offset.

---

## Design Decisions (resolved via grill-me)

| Decision | Choice |
|---|---|
| Trigger mechanism | CLI npm scripts (`npm run dev:advance-day`, `dev:advance-30min`) |
| Time advance strategy | Global in-memory clock offset applied via helper function |
| Auto-trigger on +1 day | Yes — flush batch + run compliance day-transition immediately |
| Offset accumulation | Cumulative (stacking); includes reset command |
| Persistence | In-memory only — resets on process restart |
| CLI ↔ server bridge | CLI scripts hit Express dev routes via HTTP |
| Route gating | Always registered (no env gate for now) |

---

## Proposed Changes

### `src/dev/clock.ts` [NEW]

Central dev clock module that owns the time offset state.

- **`let offsetMs: number = 0`** — cumulative millisecond offset from real time.
- **`devNow(): Date`** — returns `new Date(Date.now() + offsetMs)`. All code that currently calls `new Date()` for timestamping will use this instead.
- **`advanceDay(): void`** — adds `24 * 60 * 60 * 1000` ms to `offsetMs`.
- **`advance30Min(): void`** — adds `30 * 60 * 1000` ms to `offsetMs`.
- **`resetClock(): void`** — sets `offsetMs = 0`.
- **`getOffsetMs(): number`** — returns current offset (for logging/status).

```ts
let offsetMs = 0;

export function devNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function advanceDay(): void {
  offsetMs += 24 * 60 * 60 * 1000;
}

export function advance30Min(): void {
  offsetMs += 30 * 60 * 1000;
}

export function resetClock(): void {
  offsetMs = 0;
}

export function getOffsetMs(): number {
  return offsetMs;
}
```

---

### `src/bot/bot.ts`

- **Import** `devNow` from `../dev/clock.js`.
- **Replace** `new Date().toISOString()` (batch anchor timestamp, line 85) with `devNow().toISOString()`.
- **Add dev routes** to the Express app:
  - `POST /dev/advance-day` — calls `advanceDay()`, then triggers `flushPendingBatch` + `loadClient` for `BOT_CLIENT_ID`. Returns JSON with new offset and current dev time.
  - `POST /dev/advance-30min` — calls `advance30Min()`. Returns JSON with new offset and current dev time.
  - `POST /dev/reset-clock` — calls `resetClock()`. Returns JSON confirmation.
  - `GET /dev/clock` — returns current offset and effective dev time for inspection.

---

### `src/compliance/compliance.ts`

- **Import** `devNow` from `../dev/clock.js`.
- **Replace** `new Date()` in `getLocalDateStr` (lines 9, 21) with `devNow()` — so the fallback and default reference dates respect the dev offset.

---

### `src/scheduler/hourly.ts`

- **Import** `devNow` from `../dev/clock.js`.
- **Replace** `new Date()` (line 18, 34) with `devNow()` — so the hourly cron logs and midnight detection use the dev-offset time.

---

### `src/state/store.ts`

- **Import** `devNow` from `../dev/clock.js`.
- **Replace** `new Date()` in `createClient` (if any implicit usage via `getLocalDateStr` calls — currently uses `getLocalDateStr(timezone, timestamp)` which already threads through). No direct `new Date()` calls here, but verify all paths respect the offset.

---

### `src/dev/advanceDay.ts` [NEW]

Standalone CLI script (run via `tsx`). Sends `POST http://localhost:<BOT_PORT>/dev/advance-day` and prints the response.

```ts
const port = process.env.BOT_PORT || '4000';
const res = await fetch(`http://localhost:${port}/dev/advance-day`, { method: 'POST' });
const data = await res.json();
console.log('⏩ Advanced +1 day:', data);
```

---

### `src/dev/advance30Min.ts` [NEW]

Same pattern — hits `/dev/advance-30min`.

---

### `src/dev/resetClock.ts` [NEW]

Same pattern — hits `/dev/reset-clock`.

---

### `package.json`

Add npm scripts:

```json
"dev:advance-day": "tsx src/dev/advanceDay.ts",
"dev:advance-30min": "tsx src/dev/advance30Min.ts",
"dev:reset-clock": "tsx src/dev/resetClock.ts"
```

---

## Verification Plan

### Build Check
- `npm run build` — TypeScript compilation must pass with no errors.

### Scenario Table

| Scenario | Command | Expected Result |
|---|---|---|
| Advance 1 day, no pending messages | `npm run dev:advance-day` | `loadClient` triggers day transition; if no GM was received, logs a Miss and resets streak |
| Advance 1 day, pending messages | `npm run dev:advance-day` | Batch flushed first with anchored timestamp, then day-transition runs |
| Advance 30 min | `npm run dev:advance-30min` | Offset increases by 30 min; no side effects triggered |
| Advance 3 days | Run `dev:advance-day` × 3 | Offset = +3 days; 3 day transitions processed; 3 misses logged if no GMs sent |
| Reset clock | `npm run dev:reset-clock` | Offset returns to 0; new messages use real time |
| Send message after advancing | `curl /webhook` after advance | Batch anchor uses dev-offset time, so message is credited to the correct simulated day |
| Process restart | Stop and restart `npm run dev` | Offset is 0 again (in-memory only) |

### Manual Verification
- Start the server with `npm run dev`.
- Send a GM message via `/webhook`.
- Run `npm run dev:advance-day` and verify the JSON state file shows day-transition effects.
- Run `npm run dev:advance-day` again without sending a GM — verify a Miss is logged.

---

## Progress Checklist

- [ ] Create `src/dev/clock.ts` with offset helpers
- [ ] Update `src/bot/bot.ts`: import `devNow`, replace `new Date()`, add dev routes
- [ ] Update `src/compliance/compliance.ts`: import and use `devNow`
- [ ] Update `src/scheduler/hourly.ts`: import and use `devNow`
- [ ] Verify `src/state/store.ts` paths respect dev clock (no changes expected)
- [ ] Create `src/dev/advanceDay.ts` CLI script
- [ ] Create `src/dev/advance30Min.ts` CLI script
- [ ] Create `src/dev/resetClock.ts` CLI script
- [ ] Update `package.json` with new npm scripts
- [ ] Run `npm run build` and verify clean compile
- [ ] Manual end-to-end test
