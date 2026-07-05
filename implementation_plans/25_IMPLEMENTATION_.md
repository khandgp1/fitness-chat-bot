# GM Response Cleanup + 5pm Telegram Delivery

> **Plan Index:** 25
> **Goal:** Two focused changes to the Telegram integration:
>
> 1. Remove the `getRandomResponse()` call on GM receipt — the bot is silent after a valid GM is batched and flushed.
> 2. Deliver the 5pm compliance reply (`select5pmReply`) to Telegram via `sendTelegramReply()` in addition to logging it.
>
> **Exit Criteria:** A valid GM from Telegram produces no reply. At 5pm local time, the bot proactively sends the compliance reply (e.g. `"G"`, `"G. You got this. Keep going"`, or `"bruv"`) to the user's Telegram chat.

---

## Design Decisions (Resolved via /grill-me)

| Decision              | Choice                                                      | Rationale                                                                                                                     |
| :-------------------- | :---------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **Post-GM response**  | Silent — no reply is sent after a valid GM is classified    | The 5pm message is the sole outbound reply                                                                                    |
| **5pm chatId lookup** | Use the in-memory `telegramChatIds` map in `telegramBot.ts` | Same map already used by `sendTelegramReply()`; if user hasn't messaged this session, a warning is logged and no message sent |

---

## Proposed Changes

### 1. Bot — Remove GM response, wire 5pm delivery

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

**Change A — `processBatch()`: Remove the `getRandomResponse()` reply block**

Remove the entire conditional that calls `getRandomResponse()` and `sendTelegramReply()` after saving state. The `shouldRespond` call and `getRandomResponse` import can also be removed since they are no longer used.

Before:

```typescript
// Evaluate if we should respond
const responseDecision = shouldRespond(updatedState);
const finalState = responseDecision.updatedState;

// Save state
saveClient(finalState);

// If decision is to respond, send reply to Telegram (no-op for sandbox users)
if (
  responseDecision.respond &&
  finalState.compliance_status === 'Compliant' &&
  finalState.gm_received_today
) {
  const reply = getRandomResponse();
  await sendTelegramReply(userId, reply);
}
```

After:

```typescript
// Save state
saveClient(updatedState);
```

Also remove the now-unused imports from the top of `bot.ts`:

- `import { shouldRespond } from '../response/responseEngine.js';`
- `import { getRandomResponse } from '../response/contentLibrary.js';`

> [!NOTE]
> `sendTelegramReply` remains imported — it is still used in the 5pm delivery path below.

---

**Change B — `executeHourlyTick()`: Deliver 5pm reply to Telegram**

In the 5pm block, after logging the reply, call `sendTelegramReply()`:

Before:

```typescript
if (localHour === 17) {
  const reply = select5pmReply(clientState);
  logMessage('[BOT-5PM]', reply, now.toISOString());
  console.log(`[Scheduler] 5pm reply logged for client "${clientId}": "${reply}"`);
}
```

After:

```typescript
if (localHour === 17) {
  const reply = select5pmReply(clientState);
  logMessage('[BOT-5PM]', reply, now.toISOString());
  console.log(`[Scheduler] 5pm reply logged for client "${clientId}": "${reply}"`);
  await sendTelegramReply(clientId, reply);
}
```

> [!NOTE]
> `sendTelegramReply` is already a no-op for sandbox users (no stored `chatId`), so this is safe for both channels.
> `executeHourlyTick` is already `async`, so no signature change is needed.

---

## Verification Plan

### Manual End-to-End Test

| #   | Action                                                          | Expected Console Output                                           | Expected Telegram                         |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| 1   | Send `"GM"` from Telegram + trigger tick                        | `[Batch Processed]...` logged                                     | **No reply**                              |
| 2   | Advance clock to 5pm local (`/dev/advance-1hour` until hour 17) | `[Scheduler] 5pm reply logged...` + `[Telegram] Sending reply...` | Bot sends `"G"` (if GM received today)    |
| 3   | Send no GM today + reach 5pm with streak > 0                    | Same scheduler log                                                | Bot sends `"G. You got this. Keep going"` |
| 4   | Send no GM today + reach 5pm with streak = 0                    | Same scheduler log                                                | Bot sends `"bruv"`                        |
| 5   | Sandbox users (no Telegram chatId) at 5pm                       | `[Telegram] Stored chatId not found... Reply skipped.`            | Silence (no crash)                        |

### Linting & Formatting

```bash
npm run lint
npm run format
```

---

## Progress Checklist

- [ ] Modify `src/bot/bot.ts` — remove `shouldRespond` + `getRandomResponse` block from `processBatch()`
- [ ] Modify `src/bot/bot.ts` — remove unused imports (`shouldRespond`, `getRandomResponse`)
- [ ] Modify `src/bot/bot.ts` — add `await sendTelegramReply(clientId, reply)` in 5pm block of `executeHourlyTick()`
- [ ] Manual test: valid GM → no reply on Telegram
- [ ] Manual test: 5pm tick → correct compliance reply delivered to Telegram
- [ ] Manual test: sandbox user at 5pm → warning logged, no crash
- [ ] Run `npm run lint` and `npm run format`
