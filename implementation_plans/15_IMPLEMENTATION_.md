# 15 — Update "Advance 30 Minute" to "Advance 1 Hour"

## Goal

Update the dev clock manipulation feature from advancing 30 minutes to advancing 1 hour. This includes renaming all associated backend functions, server API routes, utility scripts, CSS/HTML dashboard triggers, and package.json scripts to reflect the 1-hour interval.

## Design Decisions (resolved via grill-me)

| Decision       | Choice                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Code Renaming  | Perform a complete rename of all occurrences (functions, files, endpoints, package.json scripts).                |
| Boundary Check | Simplify the logic to always flush the batch unconditionally, as a 1-hour shift always crosses an hour boundary. |

## Proposed Changes

### 1. Developer Clock API & Core Logic

- **Modify** [clock.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/clock.ts):
  - Rename `advance30Min()` to `advance1Hour()`.
  - Update `offsetMs += 30 * 60 * 1000;` to `offsetMs += 60 * 60 * 1000;` (1 hour in milliseconds).
  - Update description comments.

- **Modify** [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts):
  - Import `advance1Hour` instead of `advance30Min`.
  - Rename route `/dev/advance-30min` to `/dev/advance-1hour`.
  - Trigger batch flushing unconditionally when advancing 1 hour.
  - Update logging and error handling references to reflect 1 hour.

### 2. Utility Scripts & Package Scripts

- **Rename & Modify** [advance30Min.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/advance30Min.ts) to [advance1Hour.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/advance1Hour.ts):
  - Update fetch path to `http://localhost:${port}/dev/advance-1hour`.
  - Update logs to indicate advancing by +1 hour.
- **Modify** [package.json](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/package.json):
  - Rename script `dev:advance-30min` to `dev:advance-1hour` and point it to `src/dev/advance1Hour.ts`.

### 3. Developer Dashboard UI

- **Modify** [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts):
  - Update button text from `⏱️ Advance 30 Min` to `⏱️ Advance 1 Hour`.
  - Update click handler argument from `'advance-30min'` to `'advance-1hour'`.
  - Update helper notes text explaining that advancing 1 hour will always flush pending batches.

---

## Verification Plan

### Automated Checks

- Run `npm run build` to verify TypeScript compiler runs successfully.
- Run `npm run lint` and `npm run format` to check for style and format issues.

### Manual Verification

- Start the server using `npm run dev`.
- Run the new command line script `npm run dev:advance-1hour` and check that the console displays the clock advanced by 1 hour.
- Load the developer dashboard in browser: `http://localhost:4000/dev/dashboard`.
- Verify the button displays `⏱️ Advance 1 Hour` and clicking it advances the dev clock by exactly 1 hour.
- Verify that a batch is automatically processed/flushed when advancing by 1 hour (unconditionally).

---

## Progress Checklist

- [x] Rename `src/dev/advance30Min.ts` to `src/dev/advance1Hour.ts` and update it
- [x] Modify `src/dev/clock.ts` to implement `advance1Hour`
- [x] Modify `src/bot/bot.ts` to mount `/dev/advance-1hour` and invoke `advance1Hour`
- [x] Update `package.json` with `dev:advance-1hour` script
- [x] Update `src/dev/dashboardHtml.ts` button text, action, and helper notes
- [x] Build and Lint check (`npm run build`, `npm run lint`)
- [x] Verify functionality via dashboard and script execution
