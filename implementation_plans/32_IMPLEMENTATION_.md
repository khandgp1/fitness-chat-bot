# Add Developer Controls: Manual Midnight Compliance Check

When the server isn't running at midnight, the hourly cron job misses the compliance day-transition check. This change adds a **"Run Compliance Check"** button to the existing Developer Controls card in the dashboard that manually triggers `transitionClientDays` for the selected client using the current dev clock time — no clock mutation required.

## Proposed Changes

### Backend API

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

Add a new `POST /dev/run-compliance-check` endpoint that:
1. Resolves the `clientId` from the query param (same as other dev endpoints).
2. Calls `loadClient(clientId, devNow().toISOString())` — this internally calls `transitionClientDays`, catching up from `last_active_date` to the current dev date.
3. Saves the updated state via `saveClient()`.
4. Returns a JSON response with `success`, the `clientId`, the resulting `compliance_status`, and the dev clock time.

```diff
+ app.post('/dev/run-compliance-check', (req: Request, res: Response) => {
+   const clientId = resolveClientId(req);
+   try {
+     const now = devNow();
+     const state = loadClient(clientId, now.toISOString());
+     saveClient(state);
+     console.log(`[dev] Manual compliance check for "${clientId}" — status: ${state.compliance_status}`);
+     res.json({
+       success: true,
+       clientId,
+       compliance_status: state.compliance_status,
+       devTime: now.toISOString(),
+     });
+   } catch (err) {
+     console.error('[dev] Error running manual compliance check:', err);
+     res.status(500).json({ error: `Error running compliance check: ${(err as Error).message}` });
+   }
+ });
```

---

### Dashboard UI

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)

**HTML change** — Add a **"🔍 Run Compliance Check"** button to the existing Developer Controls `btn-group`, next to the clock controls:

```diff
  <div class="btn-group">
    <button class="btn btn-primary" onclick="triggerClockAction('advance-day')">☀️ Advance 1 Day</button>
    <button class="btn" onclick="triggerClockAction('advance-1hour')">⏱️ Advance 1 Hour</button>
    <button class="btn" onclick="triggerClockAction('reset-clock')">🔄 Reset Clock</button>
+   <button class="btn" onclick="triggerComplianceCheck()">🔍 Run Compliance Check</button>
  </div>
```

**JavaScript change** — Add a `triggerComplianceCheck()` function:

```diff
+ async function triggerComplianceCheck() {
+   try {
+     const res = await fetch(`/dev/run-compliance-check?clientId=${encodeURIComponent(selectedClientId)}`, { method: 'POST' });
+     if (res.ok) {
+       await pollData();
+     } else {
+       const errData = await res.json();
+       alert('Compliance check failed: ' + (errData.error || res.statusText));
+     }
+   } catch (err) {
+     console.error('Compliance check error:', err);
+     alert('Compliance check error: ' + err.message);
+   }
+ }
```

**Update the help text** below the buttons to include the new control:

```diff
- Note: Advancing the day will flush pending batches. Advancing 1 hour will also flush pending batches. Resetting client data deletes and re-creates the client state with fresh defaults.
+ Note: Advancing the day will flush pending batches. Advancing 1 hour will also flush pending batches. Resetting client data deletes and re-creates the client state with fresh defaults. Run Compliance Check triggers the midnight day-transition logic using the current dev clock time without advancing the clock.
```

## Verification Plan

### Manual Verification
1. Start the dev server (`npm run dev`).
2. Open the dashboard and select a client.
3. Confirm the **"🔍 Run Compliance Check"** button appears in the Developer Controls card.
4. Click the button and verify:
   - The state inspector updates (compliance_status, streak_count, miss_log).
   - The server console logs the manual compliance check.
   - If the client had no GM today and is past midnight, a Miss is logged.

## Checklist

- [x] Add `POST /dev/run-compliance-check` endpoint to `bot.ts`
- [x] Add "Run Compliance Check" button to the Developer Controls card in `dashboardHtml.ts`
- [x] Add `triggerComplianceCheck()` JavaScript function in `dashboardHtml.ts`
- [x] Update Developer Controls help text
- [x] Manual verification on dev dashboard
