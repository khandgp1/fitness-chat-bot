# 22 — Response Suggestion: Dashboard UI

> **Series: Response Suggestion Feature (Plans 19–22)**
>
> | Plan | Component | Depends On |
> |------|-----------|------------|
> | [19](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/19_IMPLEMENTATION_.md) | System Prompt | — |
> | [20](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/20_IMPLEMENTATION_.md) | Suggestion Engine | 19 |
> | [21](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/21_IMPLEMENTATION_.md) | API Endpoints | 20 |
> | **22** | **Dashboard UI** | **21** |

---

## Goal

Add a "Suggested Response" card to the dev dashboard that lets the coach generate, review, copy, and send AI-drafted replies — consuming the API endpoints from Plan 21.

---

## Design Decisions (from interview)

| Decision | Resolution |
|---|---|
| Trigger | Coach clicks "Generate Suggestion" button |
| Display | Shows suggestion text only (no source messages displayed) |
| Actions | Generate, Copy to clipboard, Send/Mark as sent |
| Style | Match existing dashboard card style |

---

## Proposed Changes

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)

### New Dashboard Card: "Suggested Response"

**Layout:**
```
┌─────────────────────────────────────┐
│  Suggested Response                 │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ (suggestion text area)      │    │
│  │ "No suggestion generated"   │    │
│  └─────────────────────────────┘    │
│                                     │
│  [Generate]  [Copy]  [Send]         │
│                                     │
│  Status: Ready / Generating... /    │
│          Sent ✓                     │
└─────────────────────────────────────┘
```

**Elements:**

1. **Suggestion Display Area**
   - Default state: "No suggestion generated yet" (muted text)
   - After generation: shows the draft text in a styled text block
   - After send: resets to default state

2. **Generate Button**
   - Calls `POST /dev/api/suggestions/generate`
   - Shows loading state ("Generating...") with button disabled during call
   - On success: populates the text area, enables Copy and Send buttons
   - On error: displays error message inline

3. **Copy Button**
   - Hidden/disabled until a suggestion exists
   - Copies suggestion text to clipboard
   - Brief visual feedback ("Copied!" for ~2 seconds)

4. **Send / Mark as Sent Button**
   - Hidden/disabled until a suggestion exists
   - Calls `POST /dev/api/suggestions/send`
   - On success: shows "Sent ✓", resets card after brief delay
   - Logs the message in the message log (visible in the existing Message Log card)

5. **Loading / Status indicator**
   - "Ready" (default)
   - "Generating..." (during LLM call)
   - "Sent ✓" (after send, before reset)

### JavaScript Functions (inline in dashboard HTML)

```javascript
async function generateSuggestion() { ... }
async function copySuggestion() { ... }
async function sendSuggestion() { ... }
```

### On Page Load

- Call `GET /dev/api/suggestions` to restore any existing unsent suggestion
- If a suggestion exists, populate the card immediately

---

## Verification

```bash
npm run build    # TypeScript compilation passes
npm run lint     # No lint errors
```

### Manual End-to-End Test

1. Start dev server (`npm run dev`)
2. Send several messages via webhook
3. Open dashboard at `http://localhost:4000/dev/dashboard`
4. Verify the Suggested Response card appears with "No suggestion generated yet"
5. Click "Generate Suggestion" — verify loading state, then draft appears
6. Verify draft is 1-2 sentences, direct tone, no emojis
7. Click "Copy" — verify clipboard contains the text, "Copied!" feedback shows
8. Click "Send" — verify "Sent ✓" appears, card resets, message appears in Message Log as `[BOT-SUGGESTION]`
9. Send more webhook messages, generate again — verify only new messages are included in context
10. Restart server — verify card resets, all messages available for next generation

---

## Checklist

- [ ] Add "Suggested Response" card HTML to dashboard template
- [ ] Add suggestion display area with default empty state
- [ ] Add "Generate" button with loading state and API call
- [ ] Add "Copy" button with clipboard support and feedback
- [ ] Add "Send" button with API call and reset behavior
- [ ] Add on-page-load check for existing suggestion
- [ ] Style card to match existing dashboard aesthetic
- [ ] Build check (`npm run build`)
- [ ] Lint check (`npm run lint`)
- [ ] Manual end-to-end test on dev dashboard
