# Reference: Current Architecture

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Node.js 20+ | Server runtime |
| Language | TypeScript 6 | Type safety |
| Bot Framework | Grammy 1.44 | Telegram bot (long polling) |
| LLM SDK | @anthropic-ai/sdk 0.104 | Claude API access |
| Web Server | Express 5 | Admin dashboard + webhook API |
| Scheduler | node-cron 4 | Hourly batch processing |
| Config | dotenv | Environment variables |
| Dev Runner | tsx | TypeScript execution without compile step |

## Project Structure

```
fitness-chat-bot/
├── src/
│   ├── index.ts              # Entry point — starts scheduler, Express server, Telegram bot
│   ├── bot/
│   │   ├── bot.ts            # Express server, webhook handler, dev API endpoints, batch processing
│   │   └── telegramBot.ts    # Grammy bot setup, message handler, Telegram send function
│   ├── classifier/
│   │   ├── classify.ts       # LLM classifier — Claude Haiku 4.5, forced tool-calling
│   │   └── reasoningMemory.ts # Loads operator-approved classification overrides into prompt
│   ├── compliance/
│   │   └── compliance.ts     # State machine — day transitions, GM handling, streak logic
│   ├── response/
│   │   ├── suggestionEngine.ts # LLM-powered response drafts for operator review
│   │   ├── responseEngine.ts   # Stub — response rate mechanic (not fully wired)
│   │   ├── contentLibrary.ts   # Stub — approved response library
│   │   └── fivePmReply.ts      # Daily 5pm compliance-based auto-reply
│   ├── scheduler/
│   │   └── hourly.ts         # Cron job — fires every hour, iterates all clients
│   ├── state/
│   │   ├── schema.ts         # TypeScript interfaces for ClientState
│   │   ├── store.ts          # JSON file read/write, client CRUD, day-transition on load
│   │   └── clientRoster.ts   # Manages list of registered client IDs
│   └── dev/
│       ├── clock.ts          # Dev clock with adjustable time offset
│       ├── dashboardHtml.ts  # 1200-line inline HTML/CSS/JS dashboard
│       ├── messageLog.ts     # In-memory message log for dashboard display
│       ├── resetClient.ts    # Wipe and recreate client state
│       ├── advanceDay.ts     # CLI: advance clock 24 hours
│       ├── advance1Hour.ts   # CLI: advance clock 1 hour
│       └── resetClock.ts     # CLI: reset clock offset
├── data/
│   ├── roster.json           # List of registered clients [{id, timezone}]
│   ├── <clientId>.json       # Per-client state (compliance, streaks, logs)
│   ├── <clientId>_messages.json # Per-client message log
│   ├── reasoning_memory.json # Operator-approved classification overrides
│   └── suggestion-prompt.md  # System prompt for suggestion engine
├── docs/
│   ├── Fitness_Bot_Algo_v0.md # GM Ritual Algorithm spec (v0.5)
│   ├── KICKSTART.md           # Original 5-phase build plan
│   └── INTEGRATION_GUIDE.md   # Integration notes
└── implementation_plans/
    └── 00-33_IMPLEMENTATION_.md # 33 iterative implementation plans
```

## Data Flow

### Inbound Message Pipeline
```
Client sends Telegram message
  → Grammy bot.on('message:text') handler
  → Log to in-memory message store
  → Auto-register client if new (default timezone: America/New_York)
  → Enqueue message in in-memory batch queue
  → [Wait for hourly cron tick]
  → Flush batch: concatenate queued messages
  → Classify via Claude Haiku 4.5 (forced tool-call)
  → Update compliance state (handleGmResult)
  → Save client state to JSON file
```

### Operator Response Pipeline
```
Operator opens dashboard
  → Dashboard polls /dev/api/state, /dev/api/messages, /dev/api/roster
  → Operator clicks "Generate Suggestion"
  → POST /dev/api/suggestions/generate
  → Suggestion engine loads recent messages + client state
  → Calls Claude Haiku 4.5 with coaching persona prompt
  → Returns draft text to dashboard
  → Operator can edit the suggestion text
  → Operator clicks "Send"
  → POST /dev/api/suggestions/send
  → Sends via Telegram API
  → Logs as outbound message
```

### Scheduled Pipeline
```
Every hour (node-cron: '0 * * * *')
  → For each client in roster:
    → Flush any pending message batch
    → At midnight: run day-transition (log misses, reset daily flags)
    → At 5pm local: generate and send daily compliance reply
```

## Client State Schema

```typescript
interface ClientState {
  client_id: string;
  client_handle?: string;
  timezone: string;                              // IANA timezone
  gm_received_today: boolean;
  compliance_status: 'Compliant' | 'Miss' | 'Pending Review' | 'Unknown';
  streak_count: number;
  current_response_level: 0 | 1 | 2 | 3;
  window_position: number;                       // 0-5
  responses_given: number;
  last_active_date?: string;                     // YYYY-MM-DD
  gm_log: GmLogEntry[];                         // Valid GM classifications
  miss_log: string[];                            // Dates of missed days
  pending_review_log: PendingReviewEntry[];      // Unresolved classifications
  classification_log: ClassificationLogEntry[];  // Full audit trail
}
```

## Key Architectural Characteristics

### Strengths
- **Clean domain separation** — classifier, compliance, response, state are isolated modules
- **Compliance state machine is well-designed** — handles edge cases (pending review, duplicate GMs, day transitions)
- **Dev tooling is mature** — time simulation, client reset, manual compliance checks enable fast iteration
- **Reasoning memory is clever** — operator feedback loop for classifier accuracy

### Weaknesses
- **No real agent framework** — two isolated LLM calls (classifier + suggestion), no tool-calling, no routing
- **In-memory state is fragile** — message queue, message log, suggestions are lost on restart
- **Dashboard is a monolith** — 1200 lines of inline HTML/CSS/JS in a TypeScript string template
- **No authentication or authorization** — Express endpoints are open
- **Hourly batch processing adds latency** — messages sit in queue up to 59 minutes before classification
- **Suggestion engine is context-poor** — only sees recent messages and basic compliance state, not full conversation history
- **No structured error recovery** — if the process crashes mid-batch, state may be inconsistent
- **Tight coupling to Telegram** — no channel adapter layer; Telegram-specific code is mixed into business logic

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | /webhook | Receive test messages (not used for Telegram — Grammy uses long polling) |
| GET | /dev/dashboard | Serve the admin dashboard HTML |
| GET | /dev/api/state | Get client state + dev clock |
| GET | /dev/api/messages | Get client message log |
| GET | /dev/api/roster | Get all registered clients |
| GET | /dev/api/suggestions | Get latest suggestion for a client |
| POST | /dev/api/suggestions/generate | Generate a new suggestion |
| POST | /dev/api/suggestions/send | Send a suggestion via Telegram |
| POST | /dev/advance-day | Advance dev clock 24 hours |
| POST | /dev/advance-1hour | Advance dev clock 1 hour |
| POST | /dev/reset-clock | Reset dev clock offset |
| POST | /dev/run-compliance-check | Manual compliance check |
| POST | /dev/reset | Reset client state |
