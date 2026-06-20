# Phase 7 — Revert webhook timestamp usage

> **Plan Index:** 06
> **Goal:** Completely ignore the timestamp received from webhook chat messages and pivot to using the fitness bot algorithm's system time (server's system clock via `new Date()`) for all business logic, date transitions, state loading, and audit logging.
> **Exit Criteria:** Webhook requests no longer require a `timestamp` field. Incoming requests without a `timestamp` (or with any timestamp) are processed successfully. Day transitions and logging use the server system time. All unit and integration tests pass successfully.

---

## Tech Decisions (Aligned via /grill-me)

| Decision | Choice | Rationale |
| :--- | :--- | :--- |
| **Webhook Validation** | Remove `timestamp` requirement | Remove the validation check for `timestamp` from `/webhook` in `src/bot/bot.ts`. Any incoming timestamp is completely ignored. |
| **Time Source** | Server System Clock (`new Date()`) | Use the standard JavaScript `new Date()` as the source of truth for the bot algorithm. |
| **Internal Signatures & Testing** | Keep optional `timestamp` parameters | Retain the optional `timestamp` / `timestampStr` parameters in functions like `loadClient`, `createClient`, `handleGmResult`, and `getLocalDateStr` to avoid breaking existing unit tests and mock-free date testing, but do not pass them in the webhook path. |

---

## Proposed Changes

### Bot HTTP Server

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

- Remove the regex and `Date.parse` validation for the `timestamp` field from the body of `/webhook`.
- Remove `timestamp` requirement from the initial payload structure check.
- Call `createClient`, `loadClient`, and `handleGmResult` without passing the `timestamp` parameter.

---

## Progress Checklist

- [x] Update `src/bot/bot.ts` to remove the body `timestamp` validation and ignore the field if present.
- [x] Update all client logic calls (`createClient`, `loadClient`, and `handleGmResult`) in `src/bot/bot.ts` to not pass any timestamp parameter.
- [x] Run typescript compiler (`npm run build`) to verify compile-time safety.
- [x] Run compliance and state store tests (`npx tsx src/compliance/testCompliance.ts` and `npx tsx src/state/testStore.ts`) to ensure nothing is broken.
