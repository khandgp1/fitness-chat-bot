# Support Multiple Clients

> **Plan Index:** 27
> **Goal:** The scheduler currently only ticks a single client specified by `BOT_CLIENT_ID`. This plan makes the bot fully multi-client: a `CLIENT_ROSTER` env var lists the clients to schedule, Telegram auto-registered users are automatically added to the in-memory roster at runtime, and all clients tick in parallel each hour.

---

## Design Summary

| Concern                        | Decision                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| **Roster source**              | `CLIENT_ROSTER` env var — comma-separated client IDs (e.g. `5709100278,sandbox-user`)            |
| **Dev dashboard default**      | `BOT_CLIENT_ID` still used; falls back to first entry of `CLIENT_ROSTER` if unset                |
| **Scheduler tick style**       | `Promise.all` — all clients run simultaneously                                                   |
| **Telegram auto-registration** | Preserved — any sender gets a state file on first message                                        |
| **Scheduler inclusion**        | Telegram auto-registered users are added to the in-memory roster immediately (no restart needed) |

---

## Proposed Changes

### Client Roster Module (new)

#### [NEW] [clientRoster.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/clientRoster.ts)

A lightweight in-memory singleton that:

- Initialises from `CLIENT_ROSTER` env var on module load
- Exposes `getRoster(): string[]` — returns de-duplicated list of active client IDs
- Exposes `registerClient(id: string): void` — adds a client to the in-memory roster if not already present (called by Telegram handler on first message)

```typescript
// src/state/clientRoster.ts

const roster = new Set<string>(
  (process.env.CLIENT_ROSTER ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

export function getRoster(): string[] {
  return [...roster];
}

export function registerClient(id: string): void {
  roster.add(id);
}
```

---

### Scheduler

#### [MODIFY] [hourly.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/scheduler/hourly.ts)

Replace the single `BOT_CLIENT_ID` lookup with `getRoster()`. Tick all clients in parallel via `Promise.all`.

**Before:**

```typescript
const clientId = process.env.BOT_CLIENT_ID;
if (!clientId) {
  console.warn('[Scheduler] BOT_CLIENT_ID is not configured. Skipping tick.');
  return;
}
await executeHourlyTick(clientId, now);
```

**After:**

```typescript
const clients = getRoster();
if (clients.length === 0) {
  console.warn('[Scheduler] CLIENT_ROSTER is empty. Skipping tick.');
  return;
}
console.log(`[Scheduler] Ticking ${clients.length} client(s): ${clients.join(', ')}`);
await Promise.all(
  clients.map((clientId) =>
    executeHourlyTick(clientId, now).catch((err) =>
      console.error(`[Scheduler] Error during tick for "${clientId}":`, err),
    ),
  ),
);
```

---

### Telegram Bot

#### [MODIFY] [telegramBot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/telegramBot.ts)

After `createClient()` is called for a new Telegram user, call `registerClient(userId)` to add them to the in-memory roster so their hourly ticks begin immediately.

**Change in `botInstance.on('message:text', ...)` handler:**

```typescript
// Auto-register client state if it doesn't exist
if (!clientExists(userId)) {
  console.log(`[Telegram] Client "${userId}" does not exist. Creating new client...`);
  createClient(userId, 'America/New_York');
  registerClient(userId); // ← add to in-memory scheduler roster
}
```

> [!NOTE]
> If the user is already in the roster (e.g. listed in `CLIENT_ROSTER`), `registerClient` is a no-op because the roster uses a `Set`.

---

### Bot Server (dev routes)

#### [MODIFY] [bot.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/bot/bot.ts)

Add a helper `getDevClientId()` used by all dev routes. It reads `BOT_CLIENT_ID`, falling back to the first entry in `CLIENT_ROSTER`.

```typescript
function getDevClientId(): string {
  return process.env.BOT_CLIENT_ID ?? getRoster()[0] ?? 'sandbox-user';
}
```

Replace every instance of:

- `process.env.BOT_CLIENT_ID || 'sandbox-user'`
- `process.env.BOT_CLIENT_ID` (in dev route handlers)

…with `getDevClientId()`.

The affected handlers are:

- `POST /dev/advance-day`
- `POST /dev/advance-1hour`
- `POST /dev/reset`
- `GET /dev/api/state`
- `POST /dev/api/suggestions/generate`
- `POST /dev/api/suggestions/send`
- `GET /dev/api/suggestions`
- `GET /dev/dashboard`

---

### Environment

#### [MODIFY] [.env.example](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.env.example)

Add `CLIENT_ROSTER` to the example:

```
# Comma-separated list of client IDs to tick every hour
# Include Telegram numeric IDs and/or "sandbox-user"
CLIENT_ROSTER=sandbox-user
```

Keep `BOT_CLIENT_ID` with updated comment:

```
# Dev dashboard default client (falls back to first entry in CLIENT_ROSTER if unset)
BOT_CLIENT_ID=your_client_id_here
```

---

## Verification Plan

### Manual Verification

| #   | Action                                                                         | Expected                                                     |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1   | Set `CLIENT_ROSTER=sandbox-user,5709100278` in `.env`, restart, advance 1 hour | Console logs `Ticking 2 client(s): sandbox-user, 5709100278` |
| 2   | Send a Telegram message from a user **not** in `CLIENT_ROSTER`                 | Client auto-created; next hourly tick log includes their ID  |
| 3   | Set `CLIENT_ROSTER=` (empty) and restart                                       | Console warns `CLIENT_ROSTER is empty. Skipping tick.`       |
| 4   | Leave `BOT_CLIENT_ID` unset; set `CLIENT_ROSTER=sandbox-user`                  | Dev dashboard loads `sandbox-user` state without error       |

### Lint / Format

```bash
npm run lint
npm run format
```

---

## Progress Checklist

- [ ] Create `src/state/clientRoster.ts` — in-memory roster singleton
- [ ] Modify `src/scheduler/hourly.ts` — use `getRoster()` + `Promise.all`
- [ ] Modify `src/bot/telegramBot.ts` — call `registerClient(userId)` on auto-registration
- [ ] Modify `src/bot/bot.ts` — add `getDevClientId()` helper, replace all dev-route `BOT_CLIENT_ID` references
- [ ] Modify `.env.example` — document `CLIENT_ROSTER`
- [ ] Manual test: multi-client tick works
- [ ] Manual test: new Telegram user auto-registers to scheduler mid-run
- [ ] Run `npm run lint` and `npm run format`
