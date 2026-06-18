# Phase 5 — Sandbox Chat Wire-up (replacing Telegram)

> **Plan Index:** 04
> **KICKSTART Reference:** Phase 5 of `KICKSTART.md`
> **Goal:** Replace the Grammy/Telegram wire-up with a local Express HTTP server that speaks the sandbox chat protocol. End-to-end: type a message in the sandbox UI → classified → state updated → response (or silence) delivered back to the sandbox.
> **Exit Criteria:** Sending `"GM"` in the sandbox chat triggers the full pipeline and a response appears in the UI. Sending a non-GM message produces silence. State file in `data/sandbox-user.json` reflects correct streak, compliance status, and logs.

---

## Tech Decisions (Aligned via /grill-me)

| Decision             | Choice                         | Rationale                                                                            |
| :------------------- | :----------------------------- | :----------------------------------------------------------------------------------- |
| **Bot HTTP Port**    | `4000`                         | Matches the Integration Guide example (`http://localhost:4000/webhook`) exactly      |
| **HTTP Framework**   | Express                        | Industry-standard, minimal setup, well-typed with `@types/express`                   |
| **Scope**            | Phase 5 only (4c & 4d stubbed) | Response Rate Engine and Content Library are stubbed; full 4c/4d is a follow-up plan |
| **Client ID**        | `sandbox-user`                 | Direct pass-through of `userId` from sandbox webhook payload                         |
| **Default Timezone** | `America/New_York`             | US/Eastern hardcoded; OD-10 is still an open decision                                |
| **Grammy**           | Keep as dev dependency, unused | Not removed; may be needed when switching to production Telegram                     |
| **Non-GM messages**  | Silent (no reply to sandbox)   | Matches spec §3.5 — pipeline runs, no `POST /incoming-reply` is fired                |
| **Slash commands**   | Not implemented                | Dev focus is on pipeline testing; `/start` and `/status` are deferred                |

---

## User Review Required

> [!IMPORTANT]
> The sandbox must have `BOT_WEBHOOK_URL=http://localhost:4000/webhook` set in its `.env` before testing. This is a change in the **sandbox project**, not this one. Ensure the sandbox is running on port `3001` before starting this bot server.

> [!NOTE]
> Phase 4c (Response Rate Engine) and 4d (Content Library) are **stubbed** for now. The stub always returns `{ respond: true }` and a placeholder string — meaning every valid Level 0 GM gets a response. The real conditional probability mechanic will be wired in a follow-up plan.

---

## Proposed Changes

### Dependencies

#### [MODIFY] package.json

Install Express and its types:

```bash
npm install express
npm install -D @types/express
```

Add a new npm script for running the bot server:

```json
"start": "tsx src/index.ts"
```

---

### Response Stubs (Phase 4c & 4d)

#### [NEW] src/response/responseEngine.ts

Stub implementation of the §5.2 conditional probability engine.

- Export interface `ShouldRespondResult { respond: boolean; updatedState: ClientState }`
- Export `shouldRespond(state: ClientState): ShouldRespondResult`
  - **Stub behavior:** Always returns `{ respond: true, updatedState: state }`
  - Include a `// TODO: implement §5.2 conditional probability mechanic` comment
  - Signature is identical to the final implementation so Phase 5 code needs no changes later

#### [NEW] src/response/contentLibrary.ts

Stub implementation of the §6.1 approved response library.

- Export `getRandomResponse(): string`
  - **Stub behavior:** Returns a single placeholder string: `"✅ GM received. Keep the streak going!"`
  - Include a `// TODO: implement library cycling per §6.1` comment

---

### Bot HTTP Server (Phase 5 core)

#### [NEW] src/bot/bot.ts

Express server implementing the sandbox integration contract.

**Startup:**

- Create an Express app, parse JSON bodies (`express.json()`)
- Read sandbox reply URL from env: `SANDBOX_REPLY_URL` (default: `http://localhost:3001/incoming-reply`)
- Read bot server port from env: `BOT_PORT` (default: `4000`)
- Export `startBotServer(): void` to boot the Express listener

**`POST /webhook` handler (fire-and-forget contract):**

1. Immediately respond `200 OK` with empty body
2. Extract `userId`, `message` from the request body
3. If `!clientExists(userId)` → call `createClient(userId, 'America/New_York')`
4. Load state: `loadClient(userId)`
5. Classify: `await classifyMessage(message)`
6. Update state: `handleGmResult(state, result, message)`
7. Check response: `shouldRespond(updatedState)`
8. If `shouldRespond.respond === true` AND `updatedState.compliance_status === 'Compliant'` AND not a duplicate:
   - Fetch reply text: `getRandomResponse()`
   - Fire-and-forget: `POST http://localhost:3001/incoming-reply` with `{ userId, message: replyText }`
   - Use the built-in `fetch` (Node 18+) for the outbound call; catch and log any errors
9. Save state: `saveClient(updatedState)`
10. Log the result to console: `[pipeline] userId=sandbox-user | isValidGM=true | responded=true | streak=3`

**Error handling:**

- All async errors in the fire-and-forget block are caught and logged; they never crash the server

---

### Entrypoint Update

#### [MODIFY] src/index.ts

Replace the stub `main()` with a real boot sequence:

```ts
import 'dotenv/config';
import { startMidnightScheduler } from './scheduler/midnight.js';
import { startBotServer } from './bot/bot.js';

startMidnightScheduler();
startBotServer();
console.log('GM Ritual Bot is running (Sandbox mode)...');
```

Add graceful shutdown:

```ts
process.once('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});
```

---

### Environment Variables

#### [MODIFY] .env.example

Add the two new optional env vars with comments:

```dotenv
ANTHROPIC_API_KEY=
# Sandbox integration (Phase 5)
SANDBOX_REPLY_URL=http://localhost:3001/incoming-reply
BOT_PORT=4000
```

> [!NOTE]
> `TELEGRAM_BOT_TOKEN` can be left in `.env.example` for future Telegram production use, but is not read in Phase 5.

---

## Verification Plan

### Manual End-to-End Test (using the sandbox UI)

Start both servers:

```bash
# Terminal 1 — sandbox chat project
npm run dev

# Terminal 2 — this project
npm run dev
```

Then run these scenarios in the sandbox chat UI:

| #   | Send                           | Expected in UI                                   | Expected in `data/sandbox-user.json`                                         |
| --- | ------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | `GM`                           | Response appears (Level 0 stub: always responds) | `gm_received_today: true`, `streak_count: 1`, `compliance_status: Compliant` |
| 2   | `GM` again (same session)      | No response (duplicate §4.3)                     | `streak_count` unchanged, duplicate in `classification_log`                  |
| 3   | `Can we talk about my macros?` | No response (non-GM §3.5)                        | `classification_log` entry with `is_valid_gm: false`                         |
| 4   | `Goof morning!`                | Response appears                                 | `streak_count` incremented (new day) or duplicate if same day                |

### Linting & Formatting

```bash
npm run lint
npm run format
```

---

## Progress Checklist

- [ ] Install `express` and `@types/express`
- [ ] Create `src/response/responseEngine.ts` (stub)
- [ ] Create `src/response/contentLibrary.ts` (stub)
- [ ] Create `src/bot/bot.ts` — Express server with `POST /webhook`
- [ ] Update `src/index.ts` — boot scheduler + Express server
- [ ] Update `.env.example` — add `SANDBOX_REPLY_URL` and `BOT_PORT`
- [ ] Manual end-to-end test: `GM` triggers a reply in the sandbox UI
- [ ] Manual end-to-end test: non-GM message produces silence
- [ ] Manual state inspection: `data/sandbox-user.json` is correct
- [ ] Run `npm run lint` and `npm run format`
