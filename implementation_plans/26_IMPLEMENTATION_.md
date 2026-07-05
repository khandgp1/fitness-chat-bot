# Wire `sendTelegramReply()` into Suggestion Send Handler

> **Plan Index:** 26
> **Goal:** When the **Send** button is clicked in the dev dashboard's _Suggested Response_ panel, deliver the suggestion text to the user's Telegram chat in addition to logging it locally.
>
> **Root Cause:** `POST /dev/api/suggestions/send` calls `markSuggestionSent()` which only logs the text to the in-memory message log and updates `lastSentTimestamp`. It never calls `sendTelegramReply()`, so the suggestion is never delivered to Telegram.
>
> **Exit Criteria:** Clicking Send in the dashboard dispatches the suggestion text to the Telegram user's chat via `sendTelegramReply()`. The existing logging and timestamp behaviour is unchanged.

---

## Proposed Changes

### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

The handler at `POST /dev/api/suggestions/send` (lines 289–303) is currently synchronous. It needs to become `async` to `await sendTelegramReply()`.

**Before:**

```typescript
app.post('/dev/api/suggestions/send', (req: Request, res: Response) => {
  const clientId = process.env.BOT_CLIENT_ID || 'sandbox-user';
  const { suggestion } = req.body;
  try {
    const latest = getLatestSuggestion(clientId);
    if (!latest && !suggestion) {
      res.status(400).json({ success: false, error: 'No suggestion to send' });
      return;
    }
    markSuggestionSent(clientId, suggestion);
    res.json({ success: true, sentAt: devNow().toISOString() });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});
```

**After:**

```typescript
app.post('/dev/api/suggestions/send', async (req: Request, res: Response) => {
  const clientId = process.env.BOT_CLIENT_ID || 'sandbox-user';
  const { suggestion } = req.body;
  try {
    const latest = getLatestSuggestion(clientId);
    if (!latest && !suggestion) {
      res.status(400).json({ success: false, error: 'No suggestion to send' });
      return;
    }
    const textToSend = suggestion ?? latest!.suggestion;
    markSuggestionSent(clientId, suggestion);
    await sendTelegramReply(clientId, textToSend);
    res.json({ success: true, sentAt: devNow().toISOString() });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});
```

**Key changes:**

- Handler becomes `async`
- `textToSend` is resolved from the request body (or falls back to the stored suggestion) **before** `markSuggestionSent` clears it from the map
- `await sendTelegramReply(clientId, textToSend)` fires the Telegram delivery
- `sendTelegramReply` is already imported — no new imports needed
- For sandbox-only users (no stored `chatId`), `sendTelegramReply` logs a warning and returns silently — no crash

> [!NOTE]
> `sendTelegramReply` errors are caught and logged inside the helper itself. Any uncaught error from the Express handler is caught by the existing `try/catch` and returned as `{ success: false, error: ... }` to the dashboard.

---

## Verification Plan

| #   | Action                                                                  | Expected Console                                         | Expected Telegram                        |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| 1   | Click **Generate** in the dashboard, then click **Send**                | `[Telegram] Sending reply to "<id>"...` logged           | Suggestion text appears in Telegram chat |
| 2   | Click **Send** when no Telegram token is configured (sandbox-only mode) | `[Telegram] Bot instance is not running. Reply skipped.` | Nothing — no crash                       |

```bash
npm run lint
npm run format
```

---

## Progress Checklist

- [ ] Modify `src/bot/bot.ts` — make `/dev/api/suggestions/send` handler `async`, resolve `textToSend`, add `await sendTelegramReply(clientId, textToSend)`
- [ ] Manual test: Send button delivers suggestion to Telegram
- [ ] Manual test: Send in sandbox-only mode → warning logged, no crash
- [ ] Run `npm run lint` and `npm run format`
