# Telegram Wire-up — Grammy Long Polling (Side-by-Side with Sandbox)

> **Plan Index:** 24
> **KICKSTART Reference:** Phase 5 of `KICKSTART.md` (adapted)
> **Goal:** Connect the fitness bot to a real Telegram user via Grammy long polling, running alongside the existing sandbox Express server. A Telegram user sends a "GM" → the message is enqueued into the existing batch queue → the hourly cron tick processes it → the bot replies via Telegram's `sendMessage` API.
> **Exit Criteria:** A real Telegram message from a phone flows through the full pipeline (enqueue → classify → compliance → state update). The bot sends the reply back to Telegram. The sandbox Express server and dev dashboard continue to work simultaneously.

---

## Design Decisions (Resolved via /grill-me)

| Decision                     | Choice                                                                                 | Rationale                                                      |
| :--------------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------- |
| **Sandbox coexistence**      | Side-by-side — both sandbox Express + Grammy run in the same process                   | Keeps sandbox UI and dev dashboard available for testing       |
| **Connection mode**          | Long polling via `bot.start()`                                                         | Simplest setup, no public URL needed, perfect for local dev    |
| **Message processing**       | Same batch queue — Telegram messages are enqueued and flushed on the hourly cron tick  | Consistent architecture across both channels                   |
| **Client ID**                | Telegram user's numeric ID (`ctx.from.id.toString()`) — each user gets their own state | Globally unique, auto-available from Grammy context            |
| **Scheduler scope**          | Single client via `BOT_CLIENT_ID` — multi-client scheduler is a follow-up              | Keeps scope tight; only one Telegram user to start             |
| **Reply delivery**           | `bot.api.sendMessage(chatId, text)` for Telegram; sandbox keeps `POST /incoming-reply` | No unified abstraction needed; keep each channel simple        |
| **Proactive messages (5pm)** | Log-only for now — not sent to Telegram                                                | Follow-up task                                                 |
| **Commands**                 | None — no `/start` or `/status` this phase                                             | Bot only responds to organic GM messages                       |
| **File organization**        | New `src/bot/telegramBot.ts` — separate from `bot.ts`                                  | Clean separation of Telegram logic from sandbox Express server |

---

## User Review Required

> [!IMPORTANT]
> Your real `TELEGRAM_BOT_TOKEN` must be set in `.env` (replacing the placeholder). The bot will **skip** Grammy initialization if the token is missing or still set to the placeholder value, so the sandbox-only flow continues to work.

> [!IMPORTANT]
> For the scheduler to process your Telegram user's batches, `BOT_CLIENT_ID` in `.env` must match your Telegram user ID (the numeric ID, e.g. `123456789`). You can find this by messaging your bot once and checking the console log.

---

## Proposed Changes

### Bot — Telegram Integration

#### [NEW] [telegramBot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/telegramBot.ts)

Grammy bot initialization and Telegram message handler. This file owns all Telegram-specific logic.

**Exports:**

- `startTelegramBot(): void` — initializes the Grammy `Bot`, registers handlers, calls `bot.start()`
- `getTelegramBot(): Bot | null` — returns the bot instance (for `bot.api.sendMessage()` at batch-flush time), or `null` if Telegram is disabled

**Startup logic:**

1. Read `TELEGRAM_BOT_TOKEN` from `process.env`
2. If missing or still the placeholder value (`placeholder_telegram_bot_token`), log a warning and return without starting — the bot runs in sandbox-only mode
3. Create `new Bot(token)`
4. Register `bot.on('message:text')` handler (see below)
5. Call `bot.start()` with an `onStart` callback that logs the bot's username
6. Handle errors: register `bot.catch()` to log Grammy errors without crashing

**`bot.on('message:text')` handler:**

1. Extract `userId` from `ctx.from.id.toString()`
2. Extract `chatId` from `ctx.chat.id` — store in a module-level `Map<string, number>` called `telegramChatIds` so it can be retrieved at batch-flush time
3. Extract `message` from `ctx.message.text`
4. Log the incoming message: `[Telegram] Received from "${userId}": "${message}"`
5. Call `enqueueMessage(userId, message)` (imported from `bot.ts` — see next section)
6. Log the incoming message to the dev message log via `logMessage(userId, message, devNow().toISOString())`

**Reply helper (exported):**

- `sendTelegramReply(userId: string, text: string): Promise<void>` — looks up the `chatId` from `telegramChatIds`, calls `bot.api.sendMessage(chatId, text)`. If no chatId is found or bot is null, logs a warning and returns silently.

---

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

Two changes to the existing sandbox Express server:

**1. Extract an `enqueueMessage()` function (new export):**

Refactor lines 138–147 of the webhook handler into a standalone exported function:

```typescript
export function enqueueMessage(userId: string, message: string): void {
  if (!messageQueues.has(userId)) {
    messageQueues.set(userId, []);
    batchStartTimestamps.set(userId, devNow().toISOString());
    console.log(
      `[Queue] New batch started for client "${userId}" — processing deferred to next hourly cron tick`,
    );
  }
  messageQueues.get(userId)!.push(message);
}
```

The existing `/webhook` POST handler then calls `enqueueMessage(userId, message)` instead of inlining the queue logic. No behavior change for sandbox.

**2. Add Telegram reply at batch-flush time:**

In `processBatch()`, after `saveClient(updatedState)` (line 49), add a call to send the reply via Telegram if the user has a stored chatId:

```typescript
import { sendTelegramReply } from './telegramBot.js';

// After saveClient(updatedState):
if (updatedState.compliance_status === 'Compliant' && updatedState.gm_received_today) {
  const reply = getRandomResponse();
  await sendTelegramReply(userId, reply);
}
```

> [!NOTE]
> `sendTelegramReply` is a no-op if the user doesn't have a stored Telegram chatId (i.e. they're a sandbox user), so this is safe for both channels. The sandbox reply path (`POST /incoming-reply`) is untouched.

---

### Entrypoint

#### [MODIFY] [index.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/index.ts)

Add a call to start the Telegram bot alongside the existing sandbox server:

```typescript
import 'dotenv/config';
import { startHourlyScheduler } from './scheduler/hourly.js';
import { startBotServer } from './bot/bot.js';
import { startTelegramBot } from './bot/telegramBot.js';

// Start the hourly batch + compliance scheduler
startHourlyScheduler();

// Start the sandbox Express server
startBotServer();

// Start the Telegram bot (skipped if TELEGRAM_BOT_TOKEN is not configured)
startTelegramBot();

console.log('GM Ritual Bot has successfully started.');

// Handle graceful shutdown
process.once('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
```

---

### Environment

#### [MODIFY] [.env](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.env)

Replace the placeholder token with the real BotFather token. Update `BOT_CLIENT_ID` to match the Telegram user's numeric ID (discoverable on first message — see verification plan).

```dotenv
# Telegram
TELEGRAM_BOT_TOKEN=<your_real_botfather_token>

# ...existing keys unchanged...

BOT_CLIENT_ID=<your_telegram_numeric_user_id>
```

#### [MODIFY] [.env.example](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.env.example)

Add a comment clarifying the token and client ID usage:

```dotenv
# Telegram (leave as placeholder to run in sandbox-only mode)
TELEGRAM_BOT_TOKEN=placeholder_telegram_bot_token

# ...existing keys unchanged...

# Set to your Telegram numeric user ID for scheduler ticks, or "sandbox-user" for sandbox-only
BOT_CLIENT_ID=your_client_id_here
```

---

## Verification Plan

### Manual End-to-End Test

**Step 1 — Discover your Telegram user ID:**

1. Set `TELEGRAM_BOT_TOKEN` in `.env` to your real BotFather token
2. Keep `BOT_CLIENT_ID=sandbox-user` temporarily
3. Run `npm run dev`
4. Send any message to your bot from the Telegram app
5. Read the console log: `[Telegram] Received from "123456789": "hello"` — copy the numeric ID

**Step 2 — Configure and restart:**

1. Set `BOT_CLIENT_ID=123456789` (your numeric ID) in `.env`
2. Restart: `npm run dev`

**Step 3 — Test the full pipeline:**

| #   | Action                                                                           | Expected Console Output                                              | Expected Telegram Response                                              |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Send `"GM"` from Telegram                                                        | `[Telegram] Received...` + `[Queue] New batch started...`            | No immediate reply (batched)                                            |
| 2   | Wait for next hourly tick (or use `/dev/advance-1hour` in the sandbox dashboard) | `[Batch] Processing batch...` + `[Batch Processed]...`               | Bot replies with `"✅ GM received. Keep the streak going!"` on Telegram |
| 3   | Check `data/123456789.json`                                                      | File exists with `compliance_status: "Compliant"`, `streak_count: 1` | —                                                                       |
| 4   | Send `"Can we talk about macros?"` + trigger tick                                | Classified as non-GM, no Telegram reply                              | Silence                                                                 |
| 5   | Open sandbox dashboard (`localhost:4000/dev/dashboard`)                          | Dashboard loads normally                                             | —                                                                       |
| 6   | Send a message via sandbox UI                                                    | Sandbox pipeline works as before                                     | —                                                                       |

### Linting & Formatting

```bash
npm run lint
npm run format
```

---

## Progress Checklist

- [ ] Create `src/bot/telegramBot.ts` — Grammy init, text handler, reply helper
- [ ] Modify `src/bot/bot.ts` — extract `enqueueMessage()`, add Telegram reply in `processBatch()`
- [ ] Modify `src/index.ts` — import and call `startTelegramBot()`
- [ ] Update `.env` — set real `TELEGRAM_BOT_TOKEN`
- [ ] Update `.env.example` — clarify comments
- [ ] Discover Telegram user ID from console log
- [ ] Set `BOT_CLIENT_ID` to Telegram user ID in `.env`
- [ ] Manual test: `"GM"` → batch flush → Telegram reply received
- [ ] Manual test: non-GM message → silence
- [ ] Manual test: sandbox dashboard still works
- [ ] Run `npm run lint` and `npm run format`
