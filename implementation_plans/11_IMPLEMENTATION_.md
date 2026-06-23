# 11 — Internal Dev Dashboard

Add an HTML dev dashboard served from the existing Express server at `GET /dev/dashboard`. Two side-by-side panels: a **Chat Log** (left) and **Bot State Inspector** (right). Includes interactive controls for dev clock manipulation and message sending. Dark theme, polls every 3 seconds.

---

## Architecture Decisions

| Decision | Choice |
|---|---|
| Serving | Embedded in existing Express server (`GET /dev/dashboard`) |
| Update mechanism | Polling every 3 s via `fetch()` |
| Chat panel data | In-memory webhook message log (userId + message + timestamp) |
| Bot state data | Full `ClientState` + dev clock info |
| Interactive controls | Advance Day, Advance 30 min, Reset Clock, Send Message form |
| Layout | Side-by-side split (chat left, state right) |
| Visual style | Dark theme, terminal-inspired dev aesthetic |

---

## Proposed Changes

### Server-Side

#### [NEW] `src/dev/messageLog.ts`

A small in-memory message log module:

- `logMessage(userId: string, message: string, timestamp: string): void` — pushes to an array
- `getMessages(): Array<{ userId, message, timestamp }>` — returns all logged messages
- Capped at ~500 entries (oldest evicted) to prevent memory leaks in long-running dev sessions

#### [MODIFY] `src/bot/bot.ts`

- Import `logMessage` from `messageLog.ts`
- In the `/webhook` handler, after validation, call `logMessage(userId, message, devNow().toISOString())`

#### [MODIFY] `src/bot/bot.ts` (new endpoints)

Add three new `GET` endpoints to serve dashboard data:

| Endpoint | Returns |
|---|---|
| `GET /dev/dashboard` | Serves the full HTML dashboard (inline CSS + JS) |
| `GET /dev/api/state` | JSON: full `ClientState` for `BOT_CLIENT_ID` + dev clock info |
| `GET /dev/api/messages` | JSON: array from `getMessages()` |

> **Design note**: The HTML/CSS/JS is served as a single inline response from Express (`res.send(...)`) rather than static files. This keeps the dashboard self-contained with zero build tooling — just start the server and navigate to the URL.

### Client-Side (inline HTML)

#### Dashboard HTML (`GET /dev/dashboard`)

Single-page HTML document with inline `<style>` and `<script>`:

**Layout**:
- Header bar: "GM Ritual Bot — Dev Dashboard" + live dev clock display
- Two-column flex layout below:
  - **Left panel — Chat Log**: Scrollable list of webhook messages (newest at bottom, auto-scroll). Each entry shows timestamp, userId, and message. At the bottom, a form to send a test message (userId input + message textarea + Send button).
  - **Right panel — Bot State**: Sections for:
    - Status card (compliance_status, streak_count, gm_received_today, response_level, window_position)
    - Dev Clock card (current dev time, offset) with Advance Day / Advance 30min / Reset buttons
    - GM Log table
    - Miss Log list
    - Pending Review Log table
    - Classification Log table

**Polling logic** (vanilla JS):
- `setInterval` every 3 s → fetch `/dev/api/state` and `/dev/api/messages`
- Diff against previous data; only re-render panels that changed
- Auto-scroll chat panel to bottom on new messages

**Styling** (dark theme):
- Background: `#0d1117` (GitHub dark)
- Cards: `#161b22` with subtle borders (`#30363d`)
- Accent color: `#58a6ff` (blue links/active states)
- Compliant badge: green, Miss: red, Pending Review: amber, Unknown: gray
- Monospace font for log entries
- Smooth transitions on data changes

---

## Checklist

- [ ] Create `src/dev/messageLog.ts` (in-memory log module)
- [ ] Modify `src/bot/bot.ts` — add `logMessage()` call in webhook handler
- [ ] Add `GET /dev/api/state` endpoint
- [ ] Add `GET /dev/api/messages` endpoint
- [ ] Add `GET /dev/dashboard` endpoint with inline HTML
- [ ] Build the dashboard HTML: layout, header, two-panel structure
- [ ] Build the chat log panel (message list + send form)
- [ ] Build the bot state panel (status card, clock card, log tables)
- [ ] Implement polling logic (3 s interval, smart re-render)
- [ ] Style with dark theme
- [ ] Smoke test: `npm run dev`, open `http://localhost:4000/dev/dashboard`, send a message, advance time, verify updates

---

## Verification Plan

### Manual Verification

1. Run `npm run dev`
2. Open `http://localhost:4000/dev/dashboard` in a browser
3. Send a test message via the dashboard form → verify it appears in chat log and triggers state changes
4. Click Advance Day / Advance 30 min / Reset → verify dev clock updates and state transitions
5. Confirm polling updates both panels every ~3 seconds without page reload
