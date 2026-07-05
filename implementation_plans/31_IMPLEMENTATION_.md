# Remove BOT_CLIENT_ID from Env

Remove the `BOT_CLIENT_ID` configuration variable from env files (`.env` and `.env.example`) and clean up its code references, since development dashboard routing and scheduling default to the first client in the roster.

## Proposed Changes

### Configuration
#### [MODIFY] [.env](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.env)
- Remove `BOT_CLIENT_ID=5709100278` (or other value).

#### [MODIFY] [.env.example](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.env.example)
- Remove the comment block and `BOT_CLIENT_ID` default definition on lines 11-12.

### Code
#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)
- Remove `process.env.BOT_CLIENT_ID` lookup from `getDevClientId()`.
- The updated function should return `getRoster()[0] ?? 'sandbox-user'`.

---

## Checklist

- [x] Remove `BOT_CLIENT_ID` definition from `.env`
- [x] Remove `BOT_CLIENT_ID` definition and comment from `.env.example`
- [x] Update `getDevClientId()` in `src/bot/bot.ts` to only use `getRoster()` or fallback
- [x] Verify the application compiles correctly
- [x] Verify the bot defaults to the first client in the roster when loading the dashboard (or `'sandbox-user'` if the roster is empty)

## Verification Plan

### Automated Tests
- Run compilation: `npm run build` or `npx tsc` to verify there are no TypeScript compiler errors.

### Manual Verification
1. Start the dev server: `npm run dev`.
2. Open the dev dashboard.
3. Confirm that the dashboard loads successfully, defaulting to the first client in `data/roster.json` (or `sandbox-user` if the roster is empty).
