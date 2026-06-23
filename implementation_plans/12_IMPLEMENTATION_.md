# 12 — Reset Client Data (Start Fresh)

Add a dev command that deletes all persisted client state for the configured `BOT_CLIENT_ID` and re-creates the file with fresh defaults — giving you a clean slate during development.

## Summary of Decisions (from grill-me)

| Question | Answer |
|----------|--------|
| Trigger mechanism | **POST `/dev/reset` endpoint** + **Dashboard button** |
| Scope | Only the configured `BOT_CLIENT_ID` client (e.g. `sandbox-user`) |
| Behavior | Delete `.json` file → re-create with fresh defaults (same client ID & timezone) |
| Data layers wiped | Persisted client state file only (gm_log, miss_log, classification_log, streak, compliance, etc.) |
| In-memory message log | **Not cleared** |
| In-memory message queue | **Not cleared** |
| Dev clock offset | **Not reset** |
| Confirmation | None required — fires immediately |

## Proposed Changes

### State Layer

#### [NEW] `src/dev/resetClient.ts`

New module that encapsulates the reset logic:
1. Read the existing client file to capture the **timezone** (so we preserve it).
2. Delete the `.json` file from `data/`.
3. Call `createClient(clientId, timezone)` to re-create with all defaults.
4. Return the fresh state for the API response.

Uses existing functions from `src/state/store.ts`: `loadClient`, `getClientFilePath`, `createClient`.

---

### API Layer

#### [MODIFY] `src/bot/bot.ts`

Add a new route inside `startBotServer()`:

```ts
app.post('/dev/reset', (req, res) => { ... });
```

- Reads `BOT_CLIENT_ID` from env (falls back to `'sandbox-user'`).
- Calls `resetClient(clientId)` from the new module.
- Returns `{ success: true, clientId, state: <fresh state> }`.
- Logs the action to console.

---

### Dashboard Layer

#### [MODIFY] `src/dev/dashboardHtml.ts`

Add a **"🗑️ Reset Client Data"** button to the existing "Developer Clock Controls" card (or a new adjacent card). Use the existing `btn-danger` class for a red-styled destructive action button.

Wire up an `onclick` handler that:
1. Calls `POST /dev/reset`.
2. On success, triggers `pollData()` to refresh the dashboard immediately.

---

## Checklist

- [x] Create `src/dev/resetClient.ts` with `resetClient()` function
- [x] Add `POST /dev/reset` route in `src/bot/bot.ts`
- [x] Add "Reset Client Data" button to dev dashboard HTML
- [x] Manual test: hit endpoint, verify fresh state file
- [x] Manual test: click dashboard button, verify dashboard refreshes with clean state

## Verification Plan

### Manual Verification
1. Start the dev server (`npm run dev`)
2. Send some test messages via the dashboard to populate state
3. Click the "Reset Client Data" button on the dashboard
4. Verify the dashboard stats reset (streak = 0, compliance = Unknown, all logs empty)
5. Verify `data/sandbox-user.json` on disk contains a fresh default state
6. Also test via `curl -X POST http://localhost:4000/dev/reset` and inspect the response
