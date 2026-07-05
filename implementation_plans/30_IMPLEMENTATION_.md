# Persistent Per-Client Message Stream

Make the Webhook Message Stream (left panel) persistent to disk and filtered by the currently selected client. Messages survive server restarts and switching clients shows only that client's conversation history.

## Design Decisions (Confirmed)

- **Persistence**: JSON file per client at `data/<clientId>_messages.json`
- **Content**: All messages to/from a client — user webhooks AND bot responses (5PM replies, sent suggestions)
- **Cap**: 500 messages per client (evict oldest)
- **Clear behavior**: Remove the standalone "Clear" button; "Reset Client Data" now also wipes the message log file
- **Bot messages**: Show with `[BOT]` label, same visual style as user messages
- **Panel header**: Updates to show the selected client's ID (e.g. "Webhook Message Stream — sandbox-user")

---

## Proposed Changes

### Message Log Module

#### [MODIFY] [messageLog.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/messageLog.ts)

Rewrite from a single global in-memory array to a **per-client disk-persisted** message log:

- Add `getMessagesFilePath(clientId: string)` → returns `data/<clientId>_messages.json`
- `logMessage(clientId, userId, message, timestamp)` → reads from disk, appends, evicts oldest if > 500, writes back
- `getMessages(clientId)` → reads and returns messages for a specific client from disk
- `clearMessages(clientId)` → deletes the `<clientId>_messages.json` file
- Remove the old global `messages` array and `clearMessages()` with no args
- Keep the `MessageLogEntry` interface (add `direction` field: `'inbound' | 'outbound'` to distinguish user vs bot messages)

---

### Reset Client Module

#### [MODIFY] [resetClient.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/resetClient.ts)

- Import `clearMessages` from `messageLog.ts`
- Call `clearMessages(clientId)` as part of the reset flow, after deleting the state file

---

### Bot Server (API Routes)

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

**Route changes:**

1. **`POST /webhook`** — Update `logMessage()` call to pass `clientId` as the first arg and mark direction as `'inbound'`
2. **`GET /dev/api/messages`** — Accept `?clientId=` query param; return only that client's messages via `getMessages(clientId)`
3. **`POST /dev/api/messages/clear`** — **Remove this route entirely** (clear is now part of reset)
4. **5PM reply logging** (`executeHourlyTick`) — Update `logMessage` call to pass clientId and mark direction as `'outbound'`
5. **Suggestion send** (`POST /dev/api/suggestions/send`) — Add a `logMessage` call to log sent suggestions as outbound bot messages

---

### Dashboard HTML (Frontend)

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)

**HTML changes:**

1. Remove the "Clear" button from the message stream panel header
2. Update the panel header text to include the selected client ID (e.g. `Webhook Message Stream — <clientId>`)

**JavaScript changes:**

1. Update `pollData()` — pass `selectedClientId` as query param to `GET /dev/api/messages?clientId=...`
2. Remove `clearMessageStream()` function
3. Update `onClientChange()` — clear `lastMessagesHash` to force message re-fetch on client switch; update the panel header text
4. Update `updateMessages()` — messages now have a `direction` field; show `[BOT]` label for outbound messages

---

## Checklist

- [ ] Rewrite `messageLog.ts` to per-client disk persistence
- [ ] Update `resetClient.ts` to clear message log on reset
- [ ] Update `bot.ts` API routes (messages endpoint, webhook logging, remove clear route, log bot outbound messages)
- [ ] Update `dashboardHtml.ts` frontend (remove Clear button, update header, filter by client, style bot messages)
- [ ] Manual test: send messages as different clients, switch dropdown, verify stream shows correct messages
- [ ] Manual test: restart server, verify messages persist
- [ ] Manual test: reset client data, verify messages are cleared

## Verification Plan

### Manual Verification
1. Start dev server with `npm run dev`
2. Open dashboard, send test messages as different client IDs
3. Switch the client dropdown — confirm only that client's messages appear
4. Restart the server — confirm messages are still present after reload
5. Click "Reset Client Data" — confirm messages and state are both wiped
6. Send a message, advance time to 5PM — confirm bot reply appears in the stream with `[BOT]` label
