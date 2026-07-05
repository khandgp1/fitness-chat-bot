# Client Handle Support in Dev Dashboard UI

Add a human-friendly `client_handle` field to the client state that is initially populated by the `client_id` (Telegram numeric ID) but can be manually modified/replaced in the JSON files. The dev dashboard UI will show the `client_handle` instead of the non-human-friendly `client_id` everywhere, while preserving the underlying message routing and webhook endpoints that rely on numeric client IDs.

## Proposed Changes

### State & Store Configuration

---

#### [MODIFY] [schema.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/schema.ts)
- Add optional `client_handle?: string` property to the `ClientState` interface.

#### [MODIFY] [store.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/store.ts)
- In `createClient()`: Set `client_handle: clientId` on the new state instance so it is initially populated.
- In `loadClient()`: Ensure that if a client state file does not contain a `client_handle` (e.g. legacy state files), it is initialized to `state.client_id`. If this changes the state (or if other transitions do), it will write it back to disk.

#### [MODIFY] [testStore.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/testStore.ts)
- Update state store tests to assert that `client_handle` is initialized to the `client_id` and persists correctly.

### Bot Routes & UI Dashboard

---

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)
- Update `/dev/api/roster` endpoint to return an array of objects `{ id: string, handle: string }` instead of just string IDs.
- Determine the client's handle by checking `clientExists(id)` and loading the client state (defaulting to the ID if it doesn't exist).

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)
- Update `getDashboardHtml` template input to load client state and compute `clientHandle` statically for initial page rendering.
- Render the `clientHandle` in initial server-side HTML:
  - Header Webhook title: `Webhook Message Stream — ${clientHandle}`
- Update client-side script tag logic:
  - Keep track of `selectedClientHandle` variable in client-side state.
  - Update `updateRosterDropdown()` to accept `{ id, handle }[]` and populate `<option value="${c.id}">${c.handle}</option>`.
  - Update dropdown change handler to find the selected option's text (the handle) and update `webhook-stream-title`.
  - Update `updateBotState()` to show `state.client_handle || state.client_id` in the `state-client-id` element, and save this handle to `selectedClientHandle`.
  - Update `updateMessages()` to render inbound message user names as `selectedClientHandle` instead of `msg.userId`.

## Verification Plan

### Automated Tests
- Run state store tests:
  ```bash
  npx ts-node src/state/testStore.ts
  ```
- Run compliance tests to make sure no regressions are introduced:
  ```bash
  npx ts-node src/compliance/testCompliance.ts
  ```

### Manual Verification
1. Start the dev server (`npm run dev`).
2. Open the dashboard in the browser.
3. Observe that the client dropdown displays the raw ID (since no handle is customized yet).
4. Edit `data/5709100278.json` in the text editor and add `"client_handle": "Alice"` (or replace it).
5. Watch the dashboard reload / update:
   - The dropdown should now list `Alice` instead of `5709100278`.
   - The stream title should show `Webhook Message Stream — Alice`.
   - The state inspector badge should display `Alice`.
   - Incoming chat messages in the stream should show `Alice` as the sender.
   - The Webhook form "Client ID" field should still have the value `5709100278` so that sending a message submits the valid numeric ID.
