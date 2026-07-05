# 21 — Response Suggestion: API Endpoints

> **Series: Response Suggestion Feature (Plans 19–22)**
>
> | Plan                                                                                                       | Component         | Depends On |
> | ---------------------------------------------------------------------------------------------------------- | ----------------- | ---------- |
> | [19](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/19_IMPLEMENTATION_.md) | System Prompt     | —          |
> | [20](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/20_IMPLEMENTATION_.md) | Suggestion Engine | 19         |
> | **21**                                                                                                     | **API Endpoints** | **20**     |
> | [22](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/22_IMPLEMENTATION_.md) | Dashboard UI      | 21         |

---

## Goal

Wire the suggestion engine (Plan 20) into the Express server with three new API endpoints for generating, retrieving, and sending suggestions.

---

## Proposed Changes

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

### New Import

```typescript
import {
  generateSuggestion,
  markSuggestionSent,
  getLatestSuggestion,
} from '../response/suggestionEngine.js';
```

### New Routes

**`POST /dev/api/suggestions/generate`**

Triggers on-demand suggestion generation for the configured client.

```
Request:  (no body required)
Success:  200 { success: true, suggestion: SuggestionResult }
No msgs:  400 { success: false, error: "No new messages since last sent response" }
LLM fail: 500 { success: false, error: "..." }
```

- Uses `BOT_CLIENT_ID` from env (same pattern as other `/dev/` endpoints)
- Calls `generateSuggestion(clientId)`
- Catches and distinguishes "no messages" errors from LLM errors

---

**`POST /dev/api/suggestions/send`**

Marks the current suggestion as sent, updating the message window.

```
Request:  (no body required)
Success:  200 { success: true, sentAt: string }
No sugg:  400 { success: false, error: "No suggestion to send" }
```

- Calls `markSuggestionSent(clientId)`
- Returns the timestamp of when it was marked sent

---

**`GET /dev/api/suggestions`**

Retrieves the latest stored suggestion (if any).

```
Success:  200 { suggestion: SuggestionResult | null }
```

- Calls `getLatestSuggestion(clientId)`
- Returns `null` if no suggestion has been generated yet

---

## Verification

```bash
npm run build    # TypeScript compilation passes
npm run lint     # No lint errors
```

### Manual API Testing (via curl)

```bash
# Generate a suggestion
curl -X POST http://localhost:4000/dev/api/suggestions/generate

# Get current suggestion
curl http://localhost:4000/dev/api/suggestions

# Mark as sent
curl -X POST http://localhost:4000/dev/api/suggestions/send
```

---

## Checklist

- [ ] Add import for `suggestionEngine` exports to `bot.ts`
- [ ] Add `POST /dev/api/suggestions/generate` route
- [ ] Add `POST /dev/api/suggestions/send` route
- [ ] Add `GET /dev/api/suggestions` route
- [ ] Build check (`npm run build`)
- [ ] Lint check (`npm run lint`)
- [ ] Manual curl test: generate → get → send cycle
