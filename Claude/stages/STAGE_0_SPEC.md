# Stage 0 — Scaffold

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 0
**Goal:** A running `v2/` skeleton: config, dev clock, DB connection, migration runner, and the full Phase 2 schema — zero application logic, everything downstream stands on this.

---

## Design Notes

- **No application logic in this stage.** If a task tempts us to write pipeline or domain code, it belongs to a later stage.
- **The clock is the only source of time, from day one.** Every later module receives a `Clock`; nothing calls `Date.now()` directly. Clock offset **persists to a sidecar file** (`<dbPath>.clock.json`) so a simulated time survives process restarts — required for downtime simulation (Stage 2 tests). Mutating the clock (`advance`/`reset`) throws unless `devMode` — production time cannot be simulated by accident.
- **`clientDate()` lives in the clock module** — the single place that converts a UTC instant to a client-timezone `YYYY-MM-DD` (Phase 2 §1), implemented on `Intl.DateTimeFormat` (no tz library).
- **Migration runner bootstraps `schema_migrations` itself**, then applies numbered `migrations/*.sql` files above the current version, each in a transaction. Forward-only (P2-7).
- **Config is one module, one shape.** All tunables from Phase 4 land here now with defaults; secrets (Anthropic key, Telegram token, admin token) are *declared* now but validated by the module that needs them at its startup — Stage 0 runs with none set.
- Clock CLI `reset` only resets the offset in this stage; the snapshot/restore pairing arrives with Stage 2 (D20).

## File List

```
v2/
├── package.json            # type: module; deps: better-sqlite3, dotenv;
│                           # dev: typescript, tsx, vitest, @types/*
├── tsconfig.json           # strict, ES2022, NodeNext
├── vitest.config.ts
├── .env.example            # every config var, commented
├── migrations/
│   └── 001_init.sql        # full Phase 2 schema as amended by Phase 3
├── src/
│   ├── config/config.ts    # Config type + loadConfig(env)
│   ├── clock/clock.ts      # Clock service + clientDate()
│   ├── db/connection.ts    # openDb(path) with pragmas
│   ├── db/migrate.ts       # runMigrations(db, dir)
│   └── cli/clock.ts        # status | advance-day | advance-hours <n> | reset
└── test/
    ├── config.test.ts
    ├── clock.test.ts
    └── migrate.test.ts
```

## Key Interfaces

```ts
interface Config {
  dbPath: string;
  narrativesDir: string;
  promptsDir: string;
  debounceMinutes: number;              // 3
  contextMaxMessages: number;           // 30
  contextMaxDays: number;               // 14
  stalenessThresholdExchanges: number;  // 5
  stalenessThresholdDays: number;       // 14
  maxCoachTurns: number;                // 6
  port: number;                         // 3000
  devMode: boolean;
  anthropicApiKey?: string;             // validated by agents module (Stage 4)
  telegramToken?: string;               // validated by telegram adapter (Stage 3)
  adminToken?: string;                  // validated by server (Stage 6)
}
function loadConfig(env?: NodeJS.ProcessEnv): Config;  // defaults + fail-fast on malformed values

interface Clock {
  now(): Date;                          // real time + persisted offset
  offsetMs(): number;
  advance(ms: number): void;            // devMode only — throws otherwise
  reset(): void;                        // devMode only
}
function createClock(cfg: { devMode: boolean; offsetFile: string }): Clock;
function clientDate(tz: string, instant: Date): string;  // 'YYYY-MM-DD' in IANA tz

function openDb(path: string): Database;                 // WAL, foreign_keys ON, busy_timeout 5000
function runMigrations(db: Database, dir: string): { applied: number[]; version: number };
```

## Tasks

- [x] **1. Project scaffold** — `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, npm scripts (`test`, `typecheck`, `clock`, `migrate`).
  *AC: `npm test` runs an empty suite green; `npm run typecheck` clean.* ✅
- [x] **2. Config module** — type, defaults, env overrides, fail-fast on malformed numeric/boolean values.
  *AC: tests — defaults apply with empty env; overrides parse; `DEBOUNCE_MINUTES=abc` throws with a clear message.* ✅ 4 tests
- [x] **3. Clock service + `clientDate`** — offset persistence to sidecar file; devMode guard; IANA conversion.
  *AC: tests — advance/reset round-trip; offset survives a simulated restart (new instance, same file); `advance` throws when `devMode=false`; `clientDate` correct across a DST boundary and for a UTC+14 zone.* ✅ 7 tests (incl. corrupt-sidecar recovery)
- [x] **4. DB connection + migration runner** — pragma application; `schema_migrations` bootstrap; ordered, transactional, idempotent application.
  *AC: tests — fresh file reaches version 1; second run applies nothing; pragmas verified via `PRAGMA` queries; a failing migration rolls back cleanly.* ✅
- [x] **5. `001_init.sql`** — the complete Phase 2 schema as amended (11 tables, all indexes including the partial unique one-active-draft index, all CHECK constraints).
  *AC: tests — every table/index exists post-migration; inserting a second `status='draft'` row for one client fails; a bad `compliance_days.status` value fails its CHECK.* ✅ 7 tests (incl. cascade-delete + audit-survival)
- [x] **6. Clock CLI + migrate CLI** *(migrate CLI added mid-stage: the Verify line needs a way to run migrations; `src/cli/migrate.ts`)* — `status | advance-day | advance-hours <n> | reset` via tsx.
  *AC: manual — commands mutate/report the sidecar offset; `status` shows offset and effective now; refuses to mutate when `DEV_MODE=false`.* ✅ verified manually

**Stage complete:** 18 tests green, typecheck clean. Awaiting operator Verify checkpoint.

## Verify (operator checkpoint)

From `v2/`: `npm test` green → `npm run clock -- status` shows real time → `advance-day` twice, `status` shows +48h and survives across invocations → migrate a fresh DB file and open it (any SQLite browser or the CLI) to see all 11 tables → `reset` returns the clock to real time.
