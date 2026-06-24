# 10 — Console Logging for Webhook Messages and Batch Process Results

## Overview

Every time a message is sent to the bot (received via the `POST /webhook` endpoint), print a clear log of the sender and message content to the console.
Additionally, when a batch of messages is processed in `processBatch`, print a detailed, multi-line summary of the message classification, compliance status, streak count, and the latest GM log entry.

---

## Design Decisions

| Decision           | Choice                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook Log Format | `[webhook] Received message from "<userId>": "<message>"`                                                                                                                    |
| Batch Log Format   | Multi-line structured log including: Message content, classification results (validity and reasoning), compliance status, streak count, and the latest GM log entry details. |

---

## Proposed Changes

### `src/bot/bot.ts`

- Keep the webhook log inside `POST /webhook`.
- Modify `processBatch` to print a detailed multi-line text format log of the results instead of the single-line log.

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

```ts
// Replace the old console.log in processBatch with:
const latestGm = updatedState.gm_log[updatedState.gm_log.length - 1];
const latestGmStr = latestGm ? `[${latestGm.timestamp}] "${latestGm.message}"` : '[None]';

console.log(
  `[Batch Processed] userId="${userId}"\n` +
    `  - Messages: ${JSON.stringify(queue)}\n` +
    `  - Classification: ${result ? `isValidGM=${result.is_valid_gm} | Reasoning: "${result.reasoning}"` : '[Error/Timeout]'}\n` +
    `  - Compliance Status: ${updatedState.compliance_status}\n` +
    `  - Streak Count: ${updatedState.streak_count}\n` +
    `  - Latest GM Log Entry: ${latestGmStr}`,
);
```

---

## Verification Plan

### Manual Verification

- Start the server using `npm run dev`.
- Send a mock webhook request using `curl`:
  ```bash
  curl -X POST http://localhost:4000/webhook \
    -H "Content-Type: application/json" \
    -d '{"userId": "sandbox-user", "message": "hello"}'
  ```
- Verify webhook log:
  `[webhook] Received message from "sandbox-user": "hello"`
- Advance time or wait for the batch to process, then verify the multi-line batch log format:
  ```
  [Batch Processed] userId="sandbox-user"
    - Messages: ["hello"]
    - Classification: isValidGM=false | Reasoning: "..."
    - Compliance Status: Unknown
    - Streak Count: 0
    - Latest GM Log Entry: [None]
  ```

---

## Progress Checklist

- [ ] Add `console.log` for incoming messages in `src/bot/bot.ts` (Done in previous iteration)
- [ ] Add detailed multi-line console log in `processBatch` in `src/bot/bot.ts`
- [ ] Run `npm run build` to verify clean compile
- [ ] Verify output console logs manually using `curl` and `npm run dev:advance-day`
