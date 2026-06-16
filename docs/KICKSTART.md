# KICKSTART.md — GM Ritual Bot Build Plan

> **Scope:** GM Ritual end-to-end (Telegram → Claude Haiku 4.5 classification → compliance tracking → response delivery)
> **Reference Spec:** `Fitness_Bot_Algo_v0.md` (v0.5)
> **Status:** 🟡 In Progress

---

## Recommended Tech Stack

| Layer                   | Choice                                | Rationale                                                              |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| **Runtime**             | Node.js 20+ (TypeScript)              | First-class Anthropic SDK, rich Telegram bot libraries, async-friendly |
| **Bot Framework**       | [Grammy](https://grammy.dev/)         | Modern, TypeScript-native Telegram bot framework                       |
| **LLM**                 | Claude Haiku 4.5 (`claude-haiku-4-5`) | Per spec §10.1 — forced tool use against §3.4 schema                   |
| **LLM SDK**             | `@anthropic-ai/sdk`                   | Official Anthropic Node SDK                                            |
| **State / Persistence** | JSON files (per-client, flat-file)    | Zero-ops dev prototype; swap to SQLite/Postgres later                  |
| **Scheduler**           | `node-cron`                           | In-process midnight miss-detection per §4.4                            |
| **Transport**           | Long polling (Grammy default)         | No public URL/SSL needed in dev; swap to webhooks for prod             |
| **Config**              | `dotenv`                              | `.env` for API keys and bot token                                      |
| **Formatter/Linter**    | ESLint + Prettier                     | Code consistency from day one                                          |
| **TypeScript Compiler** | `tsx` (dev) / `tsc` (build)           | Fast dev iteration, typed safety                                       |

---

## Phase Overview

```
Phase 1 → Project Scaffolding       (repo, tsconfig, env, folder structure)
Phase 2 → State Model               (per-client JSON schema + read/write layer)
Phase 3 → LLM Classifier            (Claude Haiku 4.5 + forced tool use)
Phase 4 → Compliance & Response Loop (algo §4 + §5 + §6 logic, node-cron)
Phase 5 → Telegram Bot Wire-up      (Grammy long polling, end-to-end test)
```

---

## Phase 1 — Project Scaffolding

> **Goal:** A clean, typed, runnable TypeScript project with all dependencies installed and environment wired up.

### Checklist

- [x] Initialize git repo (if not already) and add `.gitignore` (exclude `node_modules/`, `.env`, `data/`)
- [x] Run `npm init -y` to create `package.json`
- [x] Install runtime dependencies:
  ```
  npm install grammy @anthropic-ai/sdk node-cron dotenv
  ```
- [x] Install dev dependencies:
  ```
  npm install -D typescript tsx @types/node @types/node-cron eslint prettier
  ```
- [x] Create `tsconfig.json` targeting ES2022, `strict: true`, `outDir: dist`
- [x] Create `.env.example` with required keys:
  ```
  TELEGRAM_BOT_TOKEN=
  ANTHROPIC_API_KEY=
  ```
- [x] Create `.env` (gitignored) and fill in real values
- [x] Set up folder structure:
  ```
  src/
    classifier/
    compliance/
    response/
    state/
    scheduler/
    bot/
    index.ts
  data/            ← JSON state files (gitignored)
  docs/            ← spec + library files
  ```
- [x] Add `"dev": "tsx src/index.ts"` script to `package.json`
- [x] Confirm `npx tsx src/index.ts` runs without errors (stub `index.ts` is fine)

**Exit Criteria:** `npm run dev` starts without errors. Folder structure and env are in place.

---

## Phase 2 — State Model

> **Goal:** A typed per-client state schema (matching §7 of the spec) with a read/write abstraction over flat JSON files.

### Schema (per §7)

Each client gets a file at `data/<client_id>.json`:

```ts
interface ClientState {
  client_id: string;
  timezone: string; // IANA timezone string
  gm_received_today: boolean;
  compliance_status: 'Compliant' | 'Miss' | 'Pending Review' | 'Unknown';
  streak_count: number;
  current_response_level: 0 | 1 | 2 | 3;
  window_position: number; // 0–5
  responses_given: number;
  gm_log: GmLogEntry[];
  miss_log: string[]; // ISO date strings
  pending_review_log: PendingReviewEntry[];
  classification_log: ClassificationLogEntry[];
}
```

### Checklist

- [ ] Create `src/state/schema.ts` — define all TypeScript interfaces above
- [ ] Create `src/state/store.ts` — implement:
  - `loadClient(clientId: string): ClientState`
  - `saveClient(state: ClientState): void`
  - `createClient(clientId: string, timezone: string): ClientState` (with sensible defaults)
  - `clientExists(clientId: string): boolean`
- [ ] Add default values on creation:
  - `current_response_level: 0` (Level 0 — Full Feedback, per §5.1 ✅ confirmed)
  - `window_position: 0`, `responses_given: 0`
  - `streak_count: 0`
  - `compliance_status: 'Unknown'`
- [ ] Write a quick manual test: create a client, load it, mutate a field, save, reload — confirm round-trip
- [ ] Ensure `data/` directory is auto-created if missing on first write

**Exit Criteria:** `loadClient` / `saveClient` / `createClient` work correctly with a round-trip JSON file. All fields match §7.

---

## Phase 3 — LLM Classifier

> **Goal:** Implement the §3 classification engine using Claude Haiku 4.5 with forced tool use against the §3.4 output schema.

### Classification Contract (§3.4)

```ts
interface ClassificationResult {
  is_valid_gm: boolean;
  reasoning: string;
}
```

### Checklist

- [ ] Create `src/classifier/classify.ts`
- [ ] Initialize Anthropic client using `@anthropic-ai/sdk` with `process.env.ANTHROPIC_API_KEY`
- [ ] Define the tool schema matching §3.4:
  ```ts
  const gmTool = {
    name: 'classify_gm',
    description: 'Classify whether a message is a valid GM check-in',
    input_schema: {
      type: 'object',
      properties: {
        is_valid_gm: { type: 'boolean' },
        reasoning: { type: 'string' },
      },
      required: ['is_valid_gm', 'reasoning'],
    },
  };
  ```
- [ ] Set `tool_choice: { type: 'tool', name: 'classify_gm' }` to force the tool (per §10.1)
- [ ] System prompt: include §3.2 guidance verbatim + §3.3 illustrative examples as few-shot grounding
- [ ] Set `model: 'claude-haiku-4-5'`, `max_tokens: 256`, **extended thinking OFF** (per §10.1)
- [ ] Implement `classifyMessage(message: string): Promise<ClassificationResult | null>`
  - Returns `null` on API error, timeout, or malformed response → triggers Pending Review (§3.6)
- [ ] Implement classification failure handling per §3.6:
  - Catch all errors and return `null` (do NOT throw)
  - Log failure reason to console
- [ ] Manual test: send 5–6 messages covering §3.3 examples, confirm `is_valid_gm` and `reasoning` are correct

**Exit Criteria:** `classifyMessage("GM")` returns `{ is_valid_gm: true, reasoning: "..." }`. `classifyMessage("Can we talk about macros?")` returns `false`. API errors return `null`.

---

## Phase 4 — Compliance & Response Loop

> **Goal:** Implement §4 (compliance logic), §5 (response rate mechanic), §6 (content delivery), and §4.4's midnight scheduler.

### Checklist

#### 4a — Compliance Logic (§4)

- [ ] Create `src/compliance/compliance.ts`
- [ ] Implement `handleGmResult(state: ClientState, result: ClassificationResult | null): ClientState`:
  - If `result === null` → trigger Pending Review (§4.6): add to `pending_review_log`, set `compliance_status: 'Pending Review'`
  - If `result.is_valid_gm === true`:
    - If `gm_received_today` is already `true` → log duplicate, return unchanged (§4.3)
    - Else → set `gm_received_today: true`, `compliance_status: 'Compliant'`, increment `streak_count`
    - Clear any same-day entries from `pending_review_log` (natural resolution per §4.6)
    - Append to `gm_log` and `classification_log`
  - If `result.is_valid_gm === false` → append to `classification_log` only, no state change
- [ ] Implement streak hold logic: streak must not increment or reset while `compliance_status === 'Pending Review'`

#### 4b — Midnight Scheduler (§4.4)

- [ ] Create `src/scheduler/midnight.ts`
- [ ] Use `node-cron` to fire at `23:59:59` in each client's local timezone (group clients by timezone)
- [ ] At midnight check for each client:
  - If `gm_received_today === true` → day already Compliant, no action
  - If `compliance_status === 'Pending Review'` → keep Pending Review, do NOT log as Miss
  - If neither → log as Miss: append to `miss_log`, reset `streak_count: 0`
  - Reset `gm_received_today: false` and `compliance_status: 'Unknown'` for the new day

#### 4c — Response Rate Logic (§5)

- [ ] Create `src/response/responseEngine.ts`
- [ ] Implement `shouldRespond(state: ClientState): { respond: boolean; updatedState: ClientState }` using the §5.2 conditional probability algorithm:
  ```
  Step 1: increment window_position
  Step 2: remaining_gms = 6 - window_position
          remaining_needed = target_responses - responses_given
  Step 3: probability = remaining_needed / remaining_gms
  Step 4: roll random float 0.00–1.00
  Step 5: if float < probability → respond (increment responses_given)
  Step 6: if window_position === 5 → reset window_position = 0, responses_given = 0
  ```
- [ ] Map `current_response_level` to `target_responses` (0→5, 1→3, 2→2, 3→1)
- [ ] Manual test: simulate 10 windows at each level, confirm ratios match spec

#### 4d — Content Delivery (§6)

- [ ] Create `docs/approved_response_library.json` — populate with 10+ placeholder GM responses (can be revised later)
- [ ] Create `src/response/contentLibrary.ts`:
  - Implement `getRandomResponse(): string` — no-repeat until full library cycled (per §6.1)
  - Track a `cycleIndex` (or shuffle + iterate) per client session; reset when exhausted
- [ ] Wire together: when `shouldRespond` returns `true`, call `getRandomResponse()` and return the message string

**Exit Criteria:** Processing a valid GM message correctly updates state, applies conditional probability, and returns a response string (or null) per the algo. A simulated run of 25 GMs at Level 1 produces approximately 15 responses (3×5 windows). Midnight scheduler logs misses correctly.

---

## Phase 5 — Telegram Bot Wire-up

> **Goal:** Connect all modules to a running Grammy bot on long polling. End-to-end: send a Telegram message → classified → state updated → response (or silence) returned to chat.

### Checklist

#### 5a — Bot Setup

- [ ] Create `src/bot/bot.ts` — initialize Grammy `Bot` with `process.env.TELEGRAM_BOT_TOKEN`
- [ ] Register a `bot.on('message:text')` handler as the main entry point
- [ ] Extract `client_id` from `ctx.from.id.toString()`
- [ ] Auto-register new clients on first message: call `createClient(clientId, defaultTimezone)` if `!clientExists(clientId)`
- [ ] Wire the full pipeline in the handler:
  ```
  receive message
    → classifyMessage(text)
    → handleGmResult(state, result)
    → if Compliant & not duplicate: shouldRespond(state)
      → if respond: send getRandomResponse() via ctx.reply()
    → saveClient(updatedState)
  ```
- [ ] Add a `/start` command: welcome message explaining the GM ritual
- [ ] Add a `/status` command (dev only): reply with the raw client state JSON (useful for manual testing)

#### 5b — Startup & Entrypoint

- [ ] Update `src/index.ts`:
  - Load `.env` via `dotenv/config`
  - Initialize midnight scheduler
  - Start bot with `bot.start()` (Grammy long polling)
  - Log `Bot is running...` on startup
- [ ] Handle graceful shutdown: `process.once('SIGINT', () => bot.stop())`

#### 5c — Manual End-to-End Testing

- [ ] Send `"GM"` → confirm response is received (Level 0: every GM gets a response)
- [ ] Send `"GM"` again same day → confirm no response (duplicate handling §4.3)
- [ ] Send `"Can we talk about my macros?"` → confirm silence (non-GM §3.5)
- [ ] Send `"Goof morning!"` → confirm classified as valid (typo handling §3.2)
- [ ] Use `/status` to inspect JSON state and verify: streak incremented, window position updated, log entries present
- [ ] Simulate a missed day by temporarily adjusting cron time → confirm Miss logged, streak reset

**Exit Criteria:** A real Telegram message flows through the full pipeline. State files update correctly. Responses are delivered per the §5.2 mechanic at Level 0 (all GMs get responses). `/status` returns clean, readable state.

---

## Open Decisions (from Spec §9 — Unresolved)

Track these here. None block the 5-phase build, but resolve before production:

| #     | Decision                                                          | Status         |
| ----- | ----------------------------------------------------------------- | -------------- |
| OD-1  | Level activation triggers (when to move from Level 0 → 1 → 2 → 3) | 🔴 Open        |
| OD-2  | Miss response behavior (what to send when a client misses a day)  | 🔴 Open        |
| OD-3  | Cut threshold — when to remove a client                           | 🔴 Open        |
| OD-4  | Non-GM message handling (coaching questions, etc.)                | 🟡 Deferred    |
| OD-5  | Pending Review resolution process (human review UI)               | 🔴 Open        |
| OD-6  | Production channel (SMS via Twilio? WhatsApp? Stay on Telegram?)  | 🔴 Open        |
| OD-7  | Approved Response Library — final tone/voice and content          | 🟡 In progress |
| OD-8  | Motivational message delivery schedule and trigger logic          | 🔴 Not started |
| OD-9  | Multi-language / non-English GM detection scope                   | 🟡 Flagged     |
| OD-10 | Client timezone — how is it captured at onboarding?               | 🔴 Open        |

---

## Files to Create (Summary)

```
fitness-chat-bot/
├── .env                          ← gitignored
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── KICKSTART.md                  ← this file
├── docs/
│   ├── Fitness_Bot_Algo_v0.md    ← spec reference
│   └── approved_response_library.json
├── data/                         ← gitignored, per-client JSON files
└── src/
    ├── index.ts
    ├── state/
    │   ├── schema.ts
    │   └── store.ts
    ├── classifier/
    │   └── classify.ts
    ├── compliance/
    │   └── compliance.ts
    ├── response/
    │   ├── responseEngine.ts
    │   └── contentLibrary.ts
    ├── scheduler/
    │   └── midnight.ts
    └── bot/
        └── bot.ts
```

---

## Progress Tracker

| Phase                           | Status         | Notes |
| ------------------------------- | -------------- | ----- |
| Phase 1 — Scaffolding           | ✅ Completed   | Scaffolding, typescript setup, ESLint + Prettier configs, and env files configured. |
| Phase 2 — State Model           | ⬜ Not Started |                                                                                     |
| Phase 3 — LLM Classifier        | ⬜ Not Started |       |
| Phase 4 — Compliance & Response | ⬜ Not Started |       |
| Phase 5 — Telegram Wire-up      | ⬜ Not Started |       |

---

_KICKSTART.md | GM Ritual Bot | Spec: Fitness_Bot_Algo_v0.md v0.5 | Stack: Node.js + TypeScript + Grammy + Claude Haiku 4.5_
