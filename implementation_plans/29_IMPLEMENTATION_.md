# Multi-Client Dashboard Support

> **Plan Index:** 29
> **Goal:** The dev dashboard currently shows data for a single hardcoded client. This plan adds a client selector dropdown in the header that lets the user switch between all clients in the roster. All API routes gain a `?clientId=` query param so the dashboard can request data for any specific client.

---

## Design Summary

| Concern                | Decision                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| **Client selector UI** | Dropdown `<select>` in the header bar, next to the clock display                                |
| **Roster discovery**   | New `GET /dev/api/roster` endpoint returns the list from `getRoster()`                          |
| **API param**          | All dev API routes accept optional `?clientId=` query param, falling back to `getDevClientId()` |
| **Webhook form sync**  | Switching clients in the dropdown also updates the webhook test form's Client ID input          |
| **Polling**            | `pollData()` passes the selected `clientId` in all fetch URLs                                   |

---

## Proposed Changes

### Backend — API Routes

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

**1. Add a new `/dev/api/roster` endpoint:**

```typescript
app.get('/dev/api/roster', (req: Request, res: Response) => {
  res.json({ clients: getRoster() });
});
```

**2. Add a helper to resolve clientId from query param:**

```typescript
function resolveClientId(req: Request): string {
  const queryId = req.query.clientId;
  if (typeof queryId === 'string' && queryId.trim()) {
    return queryId.trim();
  }
  return getDevClientId();
}
```

**3. Update all dev routes to use `resolveClientId(req)` instead of `getDevClientId()`:**

The following routes change from `const clientId = getDevClientId()` to `const clientId = resolveClientId(req)`:

| Route                           | Method |
| ------------------------------- | ------ |
| `/dev/advance-day`              | POST   |
| `/dev/advance-1hour`            | POST   |
| `/dev/reset`                    | POST   |
| `/dev/api/state`                | GET    |
| `/dev/api/suggestions/generate` | POST   |
| `/dev/api/suggestions/send`     | POST   |
| `/dev/api/suggestions`          | GET    |
| `/dev/dashboard`                | GET    |

---

### Frontend — Dashboard HTML

#### [MODIFY] [dashboardHtml.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/dev/dashboardHtml.ts)

**1. Add client selector dropdown to header:**

Insert a `<select>` element in the header between the brand and the clock display:

```html
<div class="client-selector">
  <label for="client-select">Client:</label>
  <select id="client-select" onchange="onClientChange()">
    <!-- Populated dynamically from /dev/api/roster -->
  </select>
</div>
```

Style the selector to match the dashboard's dark theme.

**2. Add a `selectedClientId` variable and update polling:**

```javascript
let selectedClientId = '${clientId}'; // Server-injected default

async function fetchRoster() {
  const res = await fetch('/dev/api/roster');
  if (res.ok) {
    const data = await res.json();
    const select = document.getElementById('client-select');
    select.innerHTML = data.clients
      .map(
        (id) => `<option value="${id}" ${id === selectedClientId ? 'selected' : ''}>${id}</option>`,
      )
      .join('');
  }
}

function onClientChange() {
  const select = document.getElementById('client-select');
  selectedClientId = select.value;
  // Sync webhook form Client ID
  document.getElementById('userId').value = selectedClientId;
  // Reset state hashes to force full re-render
  lastStateHash = '';
  lastMessagesHash = '';
  pollData();
}
```

**3. Update `pollData()` to pass `?clientId=`:**

```javascript
async function pollData() {
  const [stateRes, messagesRes] = await Promise.all([
    fetch(`/dev/api/state?clientId=${encodeURIComponent(selectedClientId)}`),
    fetch('/dev/api/messages'),
  ]);
  // ... rest unchanged
}
```

**4. Update all dev action functions to pass `?clientId=`:**

- `triggerClockAction(action)` → `fetch(\`/dev/${action}?clientId=${encodeURIComponent(selectedClientId)}\`, ...)`
- `triggerResetClient()` → `fetch(\`/dev/reset?clientId=${encodeURIComponent(selectedClientId)}\`, ...)`
- `generateSuggestion()` → `fetch(\`/dev/api/suggestions/generate?clientId=${encodeURIComponent(selectedClientId)}\`, ...)`
- `sendSuggestion()` → `fetch(\`/dev/api/suggestions/send?clientId=${encodeURIComponent(selectedClientId)}\`, ...)`
- `initSuggestions()` → `fetch(\`/dev/api/suggestions?clientId=${encodeURIComponent(selectedClientId)}\`)`

**5. On page load, call `fetchRoster()` before starting the poll loop:**

```javascript
fetchRoster();
pollData();
setInterval(pollData, 3000);
initSuggestions();
```

---

## Verification Plan

### Manual Verification

| #   | Action                                             | Expected                                             |
| --- | -------------------------------------------------- | ---------------------------------------------------- |
| 1   | Open dashboard with multiple clients in roster     | Dropdown shows all client IDs                        |
| 2   | Switch to a different client in the dropdown       | Right panel updates to show that client's state/logs |
| 3   | Send a test message after switching clients        | Webhook form sends with the selected client's ID     |
| 4   | Click "Advance 1 Hour" after switching clients     | Hourly tick runs for the selected client             |
| 5   | Click "Reset Client Data" after switching clients  | Resets the selected client (not the default)         |
| 6   | Generate + Send suggestion after switching clients | Suggestion generated/sent for the selected client    |
| 7   | Open dashboard with only one client in roster      | Dropdown shows single option, no errors              |

### Lint / Format

```bash
npm run lint && npm run format
npm run build
```

---

## Progress Checklist

- [ ] Add `GET /dev/api/roster` endpoint to `bot.ts`
- [ ] Add `resolveClientId(req)` helper to `bot.ts`
- [ ] Update all dev routes in `bot.ts` to use `resolveClientId(req)`
- [ ] Add client selector dropdown to dashboard header in `dashboardHtml.ts`
- [ ] Add `fetchRoster()`, `onClientChange()`, and `selectedClientId` state to dashboard JS
- [ ] Update `pollData()` and all dev action functions to pass `?clientId=`
- [ ] Style the client selector dropdown to match the dark theme
- [ ] Run `npm run lint && npm run format && npm run build`
- [ ] Manual verification: client switching works end-to-end
