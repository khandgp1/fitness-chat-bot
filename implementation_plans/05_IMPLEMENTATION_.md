# Phase 6 — Sandbox Timestamp Integration

> **Plan Index:** 05
> **Goal:** Update the bot Express server and state transition logic to parse, validate, and use a required ISO 8601 `timestamp` field from the incoming webhook payload, rather than relying on the server's local system clock.
> **Exit Criteria:** Webhook requests without a valid ISO 8601 timestamp return `400 Bad Request`. Messages with a valid timestamp correctly drive date transitions, state logs, and replies based on that timestamp. All tests pass.

---

## Tech Decisions (Aligned via /grill-me)

| Decision               | Choice                 | Rationale                                                                                                                                                                                  |
| :--------------------- | :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Missing Timestamp**  | `400 Bad Request`      | As aligned with the user, the timestamp is a required field. If missing or invalid, we reject immediately.                                                                                 |
| **Validation Method**  | Regex + `Date.parse()` | Verify the string matches an ISO 8601 format (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z\|[+-]\d{2}:?\d{2})$/`) and can be successfully parsed into a valid Date object.             |
| **Loading Transition** | Pass message timestamp | When loading client state to process a webhook, the client day catch-up transition is computed using the message's timestamp to align with the client's timezone-adjusted time of sending. |
| **Client Creation**    | Pass message timestamp | When a new client is enrolled during webhook handling, their initial `last_active_date` is initialized using the message's timestamp rather than the server's current date.                |

---

## Proposed Changes

### Bot HTTP Server

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

- Update the webhook body parsing to extract `timestamp`.
- Implement validation for the `timestamp` field. If `timestamp` is missing, not a string, or not a valid ISO 8601 format, immediately respond with `400 Bad Request` containing an error message.
- Move the `res.sendStatus(200)` response to occur _after_ the request payload has been verified as valid, but before launching the asynchronous pipeline.
- Pass the verified `timestamp` to `createClient(userId, 'America/New_York', timestamp)`.
- Pass the verified `timestamp` to `loadClient(userId, timestamp)`.
- Pass the verified `timestamp` to `handleGmResult(state, result, message, timestamp)`.

---

### State Store

#### [MODIFY] [store.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/store.ts)

- Update `loadClient(clientId: string, timestamp?: string): ClientState` signature to accept an optional `timestamp`.
  - Pass the custom `timestamp` to `getLocalDateStr(state.timezone, timestamp)`.
- Update `createClient(clientId: string, timezone: string, timestamp?: string): ClientState` signature to accept an optional `timestamp`.
  - Pass the custom `timestamp` to `getLocalDateStr(timezone, timestamp)`.

---

### Compliance Engine

#### [MODIFY] [compliance.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/compliance/compliance.ts)

- Update `getLocalDateStr(timezone: string, timestampStr?: string): string` to accept an optional `timestampStr`.
  - If `timestampStr` is provided, initialize the formatting reference using `new Date(timestampStr)`, otherwise fall back to `new Date()`.
- Update `handleGmResult(state: ClientState, result: ClassificationResult | null, messageText: string, timestampStr?: string): ClientState` to accept an optional `timestampStr`.
  - Pass `timestampStr` when calling `getLocalDateStr(state.timezone, timestampStr)`.
  - Use `timestampStr` for the audit and log timestamp values (e.g., in `gm_log`, `classification_log`, `pending_review_log`). Fall back to `new Date().toISOString()` if not provided.

---

### Manual Verification

1. Start the bot server:
   ```bash
   npm run dev
   ```
2. Send test webhooks using `curl` to verify payload validation:
   - Missing timestamp:
     ```bash
     curl -i -X POST http://localhost:4000/webhook \
       -H "Content-Type: application/json" \
       -d '{"userId": "sandbox-user", "message": "GM"}'
     # Expected response: 400 Bad Request
     ```
   - Invalid timestamp format:
     ```bash
     curl -i -X POST http://localhost:4000/webhook \
       -H "Content-Type: application/json" \
       -d '{"userId": "sandbox-user", "message": "GM", "timestamp": "invalid-date"}'
     # Expected response: 400 Bad Request
     ```
   - Valid timestamp:
     ```bash
     curl -i -X POST http://localhost:4000/webhook \
       -H "Content-Type: application/json" \
       -d '{"userId": "sandbox-user", "message": "GM", "timestamp": "2026-06-18T19:21:26.131Z"}'
     # Expected response: 200 OK
     ```

---

## Progress Checklist

- [x] Modify `getLocalDateStr` and `handleGmResult` in `src/compliance/compliance.ts` to accept and utilize the reference `timestamp`
- [x] Modify `loadClient` and `createClient` in `src/state/store.ts` to support optional `timestamp` passing
- [x] Update `src/bot/bot.ts` to validate the required `timestamp` payload field, return `400 Bad Request` on failure, and pass valid timestamps to state functions
- [x] Verify HTTP endpoint validation behavior manually via `curl`
