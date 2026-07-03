# 23 — Editable Suggested Response UI

Update the Suggested Response UI to make it manually editable, allowing coaches to tweak AI-generated responses or compose a custom message from scratch before copying or sending.

---

## Proposed Changes

#### [MODIFY] [suggestionEngine.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/response/suggestionEngine.ts)
- Update `markSuggestionSent(clientId: string, customText?: string): void` to support logging `customText` if provided.
- Allow sending a message even if no suggestion currently exists in the map, as long as `customText` is defined.

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)
- Update `/dev/api/suggestions/send` POST route to parse `{ suggestion }` from `req.body`.
- Pass that string to `markSuggestionSent(clientId, customText)`.

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)
- Replace static suggestion box container with a styled `<textarea>` tag.
- Implement inline styling to match existing dashboard style.
- Wire up the `oninput` handler `onSuggestionInput()` to update `currentSuggestionText` and toggle the Copy and Send buttons.
- Update `updateSuggestionUI(text)` to populate the textarea's value.
- Update `sendSuggestion()` to make a POST request with the updated `currentSuggestionText` in the body.

---

## Verification

```bash
npm run build    # TypeScript compilation passes
npm run lint     # No lint errors
```

### Manual End-to-End Test

1. Start dev server (`npm run dev`).
2. Open dashboard at `http://localhost:4000/dev/dashboard`.
3. Locate "Suggested Response" card. Ensure it shows a textarea.
4. Type a custom message in the textarea from scratch. Verify "Copy" and "Send" buttons enable.
5. Click "Copy" and verify clipboard has the custom text.
6. Click "Send" and verify the custom text appears in the Message Log under `[BOT-SUGGESTION]`.
7. Generate a suggestion via LLM. Verify it populates the textarea.
8. Edit the text of the suggestion, then click "Send". Verify the edited text is logged, not the original.

---

## Checklist

- [x] Modify `markSuggestionSent` in `src/response/suggestionEngine.ts` to accept `customText`
- [x] Modify `/dev/api/suggestions/send` route in `src/bot/bot.ts` to read suggestion from `req.body`
- [x] Replace static suggestion elements with `<textarea>` in `src/dev/dashboardHtml.ts`
- [x] Implement `onSuggestionInput()` client-side in `dashboardHtml.ts`
- [x] Update `updateSuggestionUI(text)` and `sendSuggestion()` client-side in `dashboardHtml.ts`
- [x] Run `npm run build`
- [x] Run `npm run lint`
- [x] Manually test on dev dashboard
