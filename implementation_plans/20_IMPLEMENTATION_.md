# 20 — Response Suggestion: Suggestion Engine

> **Series: Response Suggestion Feature (Plans 19–22)**
>
> | Plan                                                                                                       | Component             | Depends On |
> | ---------------------------------------------------------------------------------------------------------- | --------------------- | ---------- |
> | [19](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/19_IMPLEMENTATION_.md) | System Prompt         | —          |
> | **20**                                                                                                     | **Suggestion Engine** | **19**     |
> | [21](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/21_IMPLEMENTATION_.md) | API Endpoints         | 20         |
> | [22](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/22_IMPLEMENTATION_.md) | Dashboard UI          | 21         |

---

## Goal

Create the core suggestion engine module — handles LLM-based response generation, in-memory suggestion storage, message window tracking, and send/reset logic.

---

## Design Decisions (from interview)

| Decision           | Resolution                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| LLM                | Claude Haiku 4.5 (same SDK/client already in use for classification)                                      |
| Message window     | All client messages since last _sent_ response from this touchpoint (5pm reply does NOT reset the window) |
| Window tracking    | `lastSentTimestamp` per client, in-memory (resets on server restart)                                      |
| Suggestion storage | Latest only, in-memory, per client                                                                        |
| Generation trigger | On-demand (called by API endpoint in Plan 21)                                                             |

---

## Proposed Changes

#### [NEW] [suggestionEngine.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/response/suggestionEngine.ts)

Core module for suggestion generation and state tracking.

### Exports

**`generateSuggestion(clientId: string): Promise<SuggestionResult>`**

1. Loads the system prompt from `data/suggestion-prompt.md` (created in Plan 19)
2. Loads client state via `loadClient(clientId)` — gets streak, compliance status, gm_received_today
3. Retrieves all messages from the in-memory message log since `lastSentTimestamp` for this client
   - Filters out `[BOT-5PM]` entries (5pm reply does not count)
   - Filters out `[BOT-SUGGESTION]` entries (own sent messages)
4. If no messages found, throws an error (nothing to respond to)
5. Builds the user prompt: client state context + chronological message thread
6. Calls Claude Haiku 4.5 with system prompt + user prompt
7. Stores the result in the `suggestions` Map
8. Returns the `SuggestionResult`

**`markSuggestionSent(clientId: string): void`**

1. Retrieves the current suggestion — throws if none exists
2. Updates `lastSentTimestamp` to `devNow().toISOString()`
3. Logs the sent suggestion to the message log as `[BOT-SUGGESTION]`
4. Clears the stored suggestion from the Map

**`getLatestSuggestion(clientId: string): SuggestionResult | null`**

- Returns the currently stored suggestion, or `null` if none

### Interfaces

```typescript
export interface SuggestionResult {
  suggestion: string; // The generated draft text
  basedOnCount: number; // Number of client messages used as context
  generatedAt: string; // ISO timestamp
  clientId: string;
}
```

### In-memory State (module-level)

```typescript
const suggestions = new Map<string, SuggestionResult>();
const lastSentTimestamps = new Map<string, string>();
```

### LLM Call Details

- **Model:** `claude-haiku-4-5`
- **Max tokens:** 150 (enforces brevity — 1-2 sentences)
- **Timeout:** 10,000ms (same as classifier)
- **Retries:** 0 (same as classifier)
- **System prompt:** loaded from `data/suggestion-prompt.md` + dynamically appended client context block:
  ```
  --- Client Context ---
  Streak: {streak_count} consecutive days
  Today's status: {compliance_status}
  GM received today: {yes/no}
  ```
- **User message:** the accumulated client messages, formatted as:
  ```
  Client messages (oldest to newest):
  [{timestamp}] {message}
  [{timestamp}] {message}
  ...
  ```

### Dependencies

- `@anthropic-ai/sdk` — already installed
- `../state/store.js` — `loadClient`
- `../dev/messageLog.js` — `getMessages`, `logMessage`
- `../dev/clock.js` — `devNow`
- `fs` — to read the prompt file
- `path` — to resolve the prompt file path

---

## Verification

```bash
npm run build    # TypeScript compilation passes with new module
npm run lint     # No lint errors
```

- Module imports resolve correctly
- Can be imported by `bot.ts` (tested in Plan 21)

---

## Checklist

- [ ] Create `src/response/suggestionEngine.ts`
- [ ] Implement `SuggestionResult` interface
- [ ] Implement `generateSuggestion()` with LLM call
- [ ] Implement prompt file loading from `data/suggestion-prompt.md`
- [ ] Implement client context injection into prompt
- [ ] Implement message window filtering (exclude `[BOT-5PM]` and `[BOT-SUGGESTION]`)
- [ ] Implement `markSuggestionSent()` with timestamp tracking and message logging
- [ ] Implement `getLatestSuggestion()`
- [ ] Build check (`npm run build`)
- [ ] Lint check (`npm run lint`)
