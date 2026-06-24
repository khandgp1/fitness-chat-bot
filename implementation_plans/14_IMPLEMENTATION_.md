# 14 — Update UI Logs: Date/Time Formatting, Webhook Stream Clearing, and Enter-to-Send

## Overview

Currently, the developer dashboard displays message and log timestamps using only the time portion (e.g. `11:24:00 AM`). To provide better context when simulating multiple days or test cases, this update includes the date along with the time in all UI logs.

Additionally, to help clean up during manual testing, this update adds a "Clear" button in the Webhook Message Stream panel header to purge all in-memory webhook message entries both on the server and in the client UI.

Finally, to improve developer workflow, typing in the `Message Text` field and pressing `Enter` will submit/send the message immediately (with `Shift + Enter` reserved for inserting newlines).

---

## Design Decisions (resolved via grill-me)

| Decision              | Choice                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Affected UI Sections  | All logs calling `formatTimestamp` (Webhook Message Stream, Classification Log, GM Log, Pending Review Log)   |
| Combined Format       | Shorthand format: `M/D H:MM AM/PM` (e.g. `6/24 11:24 PM`)                                                     |
| Dev Clock Header      | Leave as `toLocaleString()` as it already displays both date and time                                         |
| Clear Button Location | In the Webhook Message Stream panel header, next to the message count                                         |
| Clear Confirmation    | Clear immediately without showing a confirmation prompt                                                       |
| Enter Key Behavior    | Pressing `Enter` in the `Message Text` textarea sends the message; pressing `Shift + Enter` inserts a newline |

---

## Proposed Changes

### 1. Backend: Message Log Management

#### [MODIFY] [messageLog.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/messageLog.ts)

Add a `clearMessages()` function to export.

```typescript
export function clearMessages(): void {
  messages.length = 0;
}
```

---

### 2. Backend: Server Routes

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

Import `clearMessages` and expose a new `POST /dev/api/messages/clear` route.

```typescript
// Import update:
import { logMessage, getMessages, clearMessages } from '../dev/messageLog.js';

// Route addition:
app.post('/dev/api/messages/clear', (req: Request, res: Response) => {
  clearMessages();
  res.json({ success: true });
});
```

---

### 3. Frontend: Dashboard HTML & JS

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)

1. Update the `formatTimestamp` helper function (lines 788–796) to extract the month and day, and format the time with 12-hour AM/PM formatting.
2. Add a `Clear` button inside the Webhook Message Stream `.panel-header`.
3. Add the client-side JavaScript function `clearMessageStream()` to call the clear endpoint and refresh the UI messages.
4. Listen to the `keydown` event on the `message` textarea to trigger a submit button click on `Enter` (without `Shift`).

**Timestamp formatting change:**

```javascript
function formatTimestamp(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    const timeStr = date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${dateStr} ${timeStr}`;
  } catch {
    return isoString;
  }
}
```

**Panel Header change:**

```html
<div class="panel-header">
  <span>Webhook Message Stream</span>
  <div style="display: flex; align-items: center; gap: 0.75rem;">
    <span class="text-sm" id="messages-count">0 messages</span>
    <button
      class="btn btn-danger"
      style="padding: 0.25rem 0.6rem; font-size: 0.75rem; border-radius: 4px;"
      onclick="clearMessageStream()"
    >
      Clear
    </button>
  </div>
</div>
```

**JS Clear handler and Enter listener:**

```javascript
async function clearMessageStream() {
  try {
    const res = await fetch('/dev/api/messages/clear', { method: 'POST' });
    if (res.ok) {
      lastMessagesHash = '';
      await pollData();
    } else {
      alert('Failed to clear messages: ' + res.statusText);
    }
  } catch (err) {
    console.error('Clear messages error:', err);
    alert('Failed to clear messages: ' + err.message);
  }
}

// Send on Enter
document.getElementById('message').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const submitBtn = document.querySelector('#webhook-form button[type="submit"]');
    if (submitBtn) {
      submitBtn.click();
    }
  }
});
```

---

## Verification Plan

### Build & Lint Check

- Run `npm run build` to ensure TypeScript compilation passes.
- Run `npm run lint` and `npm run format` to ensure style guidelines are respected.

### Manual Verification

- Start the server using `npm run dev`.
- Open the dashboard at `http://localhost:4000/dev/dashboard`.
- Send a webhook test message and verify the timestamp shows in the format `M/D H:MM AM/PM` (e.g. `6/24 11:24 PM`).
- Click "Clear" on the Webhook Message Stream panel header. Verify that the stream clears immediately.
- Type a message in the Message Text field, press `Enter` (without Shift), and verify that it submits immediately.
- Type another message, use `Shift + Enter` to insert a newline, and verify that it does not submit but inserts a new line. Then press `Enter` to submit the multiline message.

---

## Progress Checklist

- [x] Add `clearMessages` to `src/dev/messageLog.ts`
- [x] Add route `/dev/api/messages/clear` to `src/bot/bot.ts`
- [x] Update `formatTimestamp` in `src/dev/dashboardHtml.ts`
- [x] Add "Clear" button to the panel header in `src/dev/dashboardHtml.ts`
- [x] Add `clearMessageStream` function and Enter-to-send listener to script in `src/dev/dashboardHtml.ts`
- [x] Run `npm run build` to verify compilation
- [x] Run `npm run lint` and `npm run format`
- [x] Verify UI displays date with time and clear button / enter key function correctly
