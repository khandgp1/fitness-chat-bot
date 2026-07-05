# Persist Client Roster to data/roster.json

> **Plan Index:** 28
> **Goal:** Replace the `CLIENT_ROSTER` environment variable with a persistent `data/roster.json` file. The roster is the single source of truth for which clients receive scheduler ticks. New clients registered at runtime (Telegram auto-registration) are immediately written to disk — so they survive server restarts.

---

## Design Summary

| Concern                          | Decision                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Roster file location**         | `data/roster.json` (same directory as per-client state files, using `getDataDir()`)                                 |
| **File schema**                  | `{ "clients": [ { "id": "…", "timezone": "…" } ] }`                                                                 |
| **In-memory cache**              | `clientRoster.ts` loads the file on startup, keeps an in-memory `Map<id, entry>`, writes back on `registerClient()` |
| **Auto-create on missing**       | If `roster.json` doesn't exist, create it with an empty `{ "clients": [] }` and log a warning                       |
| **Default timezone**             | `America/New_York` — stored in `roster.json` on registration, configurable later by editing the file                |
| **`CLIENT_ROSTER` env var**      | **Removed entirely**                                                                                                |
| **`BOT_CLIENT_ID`**              | Kept in `.env` for dev dashboard default                                                                            |
| **Timezone in `createClient()`** | Unchanged — callers still pass the timezone; Telegram handler passes `America/New_York`                             |

---

## Proposed Changes

### Schema / types

#### [MODIFY] [schema.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/schema.ts)

Add two new types for the roster file:

```typescript
export interface RosterEntry {
  id: string;
  timezone: string; // IANA timezone string
}

export interface RosterFile {
  clients: RosterEntry[];
}
```

---

### Client Roster Module

#### [MODIFY] [clientRoster.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/clientRoster.ts)

Rewrite from an env-var-seeded `Set` to a disk-backed `Map<id, RosterEntry>`:

```typescript
import fs from 'fs';
import path from 'path';
import { RosterEntry, RosterFile } from './schema.js';
import { getDataDir } from './store.js';

const DEFAULT_TIMEZONE = 'America/New_York';

function getRosterFilePath(): string {
  return path.join(getDataDir(), 'roster.json');
}

function loadRosterFromDisk(): Map<string, RosterEntry> {
  const filePath = getRosterFilePath();

  if (!fs.existsSync(filePath)) {
    console.warn('[Roster] roster.json not found. Creating empty roster...');
    const empty: RosterFile = { clients: [] };
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(empty, null, 2), 'utf-8');
    return new Map();
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as RosterFile;
  return new Map(parsed.clients.map((c) => [c.id, c]));
}

function saveRosterToDisk(roster: Map<string, RosterEntry>): void {
  const filePath = getRosterFilePath();
  const rosterFile: RosterFile = { clients: [...roster.values()] };
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rosterFile, null, 2), 'utf-8');
}

// --- In-memory cache, loaded at module initialisation ---
const rosterMap = loadRosterFromDisk();

export function getRoster(): string[] {
  return [...rosterMap.keys()];
}

export function getRosterEntry(id: string): RosterEntry | undefined {
  return rosterMap.get(id);
}

export function registerClient(id: string, timezone: string = DEFAULT_TIMEZONE): void {
  if (rosterMap.has(id)) return;
  const entry: RosterEntry = { id, timezone };
  rosterMap.set(id, entry);
  saveRosterToDisk(rosterMap);
  console.log(`[Roster] Registered new client "${id}" (timezone=${timezone})`);
}
```

> [!NOTE]
> `registerClient` becomes a no-op if the client is already in the map — preserving existing behaviour.

---

### Env Files

#### [MODIFY] [.env](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.env)

Remove `CLIENT_ROSTER=5709100278,sandbox-user`.

#### [MODIFY] [.env.example](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.env.example)

Remove the `CLIENT_ROSTER` entry and its comment.

---

### Data file (runtime bootstrapping)

#### [NEW] [roster.json](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/data/roster.json)

Seed with the two existing clients currently in `.env`:

```json
{
  "clients": [
    { "id": "5709100278", "timezone": "America/New_York" },
    { "id": "sandbox-user", "timezone": "America/New_York" }
  ]
}
```

> [!IMPORTANT]
> This file is in `data/`, which should **not** be committed to source control if it contains real user IDs. Add `data/roster.json` to `.gitignore` if desired.

---

### No changes required in:

- `hourly.ts` — still calls `getRoster()` (same API surface)
- `telegramBot.ts` — still calls `registerClient(userId)` (same API surface)
- `bot.ts` — no `CLIENT_ROSTER` references remain; `getDevClientId()` already reads `BOT_CLIENT_ID` + `getRoster()[0]`

---

## Verification Plan

### Manual Verification

| #   | Action                                    | Expected                                    |
| --- | ----------------------------------------- | ------------------------------------------- |
| 1   | Delete `data/roster.json`, start server   | Warning logged, empty `roster.json` created |
| 2   | Start server with populated `roster.json` | Roster loaded, scheduler ticks both clients |
| 3   | Send a Telegram message from a new user   | Client added to `roster.json` on disk       |
| 4   | Restart server after step 3               | New client still in roster (persisted)      |

### Tests

```bash
npx tsx src/state/testClientRoster.ts
npm run lint && npm run format
```

---

## Progress Checklist

- [ ] Add `RosterEntry` and `RosterFile` types to `src/state/schema.ts`
- [ ] Rewrite `src/state/clientRoster.ts` — disk-backed `Map`, load on init, save on register
- [ ] Create `data/roster.json` — seed with existing two clients
- [ ] Remove `CLIENT_ROSTER` from `.env` and `.env.example`
- [ ] Update `src/state/testClientRoster.ts` to verify disk persistence
- [ ] Run `npm run lint && npm run format`
- [ ] Manual verification: delete roster → auto-created; new Telegram user → persisted
