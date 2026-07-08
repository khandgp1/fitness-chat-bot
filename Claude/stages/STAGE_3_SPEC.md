# Stage 3 — Ingestion

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 3
**Goal:** Messages flow from Telegram (and a fake adapter for tests) into durable rows and debounced batches, gated by verification. Batches end this stage as `pending` — the classifier/router that processes them is Stage 4. This stage also delivers the first *runnable app*: a composition root that boots, reconciles, sweeps, and listens.

---

## Design Notes

- **Adapter contract is inbound-dumb and outbound-dumber.** The adapter translates channel events to a neutral `InboundMessage` and exposes `send(externalId, text)`. It never touches the DB; identity resolution and all policy live in the ingestion service. (Outbound isn't *used* until Stage 5; the fake adapter records sends for later tests.)
- **Persist-before-process, literally ordered (Phase 1 §2.2):** resolve/auto-register identity → **persist message** → gate on status → batch/debounce. A crash after persist loses nothing.
- **Gating (D10):** unknown sender → auto-register as `pending_verification` (audited) and **store the message only** — no batch, no debounce, no reply. `pending_verification` → same. `blocked` → *nothing is stored*; the message is dropped (Phase 1: "silently ignored"). Only `active` clients get batches.
- **Debounce is in-memory timers + a DB sweep for crash recovery.** `touch(clientId)` (re)starts a real-time timer per client; firing closes the batch (`open→pending`). Timers die with the process, so `sweep()` closes any open batch whose newest activity is older than the debounce window — run at boot and on a periodic tick. The DB is the truth; timers are just latency optimization (P2-5).
- **Default timezone for auto-registered clients** comes from config (`DEFAULT_TIMEZONE`, default `America/New_York` — matches the prototype's behavior); the operator can correct per-client later (Stage 6 UI or `clients` CLI now).
- **Boot sequence (composition root):** load config → open DB → migrate → `reconcileAll()` → `sweep()` → start adapter → periodic tick (every 15 min: `reconcileAll` + `sweep`; both idempotent and cheap — no cron dependency).
- **Dev CLI for client admin** (`clients.ts`): list / verify / block / set-timezone — Stage 6's UI does this properly; Stages 4–5 need an active client to test against *now*.

## File List

```
v2/src/adapters/types.ts        # InboundMessage + ChannelAdapter contract
v2/src/adapters/fake.ts         # test adapter: deliver() hook, records send()s
v2/src/adapters/telegram.ts     # Grammy long-polling adapter (token from config)
v2/src/pipeline/ingest.ts       # identity resolution, auto-register, gating, persist, batch+touch
v2/src/pipeline/debounce.ts     # per-client timers + sweep()
v2/src/app.ts                   # buildApp(): wires everything; start/stop
v2/src/index.ts                 # entry point (npm start)
v2/src/cli/clients.ts           # list | verify <id> | block <id> | set-timezone <id> <tz>
v2/test/ingest.test.ts          # integration via fake adapter
v2/test/debounce.test.ts        # fake timers + sweep
```

New dependency: `grammy`. New npm scripts: `start`, `clients`.

## Key Interfaces

```ts
// adapters/types.ts
interface InboundMessage {
  channel: string;              // 'telegram'
  externalId: string;           // chat id as string
  handle?: string;              // @username if present
  displayName?: string;         // profile name
  text: string;
  channelMessageRef?: string;   // channel's message id
  rawPayload?: string;          // JSON of the raw update (debugging)
}
interface ChannelAdapter {
  readonly name: string;
  start(onMessage: (msg: InboundMessage) => void): Promise<void>;
  stop(): Promise<void>;
  send(externalId: string, text: string): Promise<void>;
}

// pipeline/ingest.ts
interface Ingestor {
  handle(msg: InboundMessage): { stored: boolean; clientId?: string; gated: 'blocked' | 'unverified' | 'batched' };
}

// pipeline/debounce.ts
interface Debouncer {
  touch(clientId: string): void;    // (re)start the client's window
  sweep(): number;                  // close overdue open batches; returns count
  stop(): void;                     // clear timers (shutdown/tests)
}
createDebouncer(deps, opts: { debounceMs: number; onBatchClosed: (batchId: string, clientId: string) => void });
// onBatchClosed is Stage 4's entry point; in Stage 3 it just logs.
```

## Tasks

- [x] **1. Adapter contract + fake adapter** — types; fake with `deliver(msg)` test hook and recorded sends.
  *AC: used by every ingest test; sends recorded with target + text.* ✅
- [x] **2. Ingestion service** — identity resolution, auto-register (audited), persist-before-process, status gating.
  *AC (integration): stranger → client row `pending_verification` + message stored + NO batch + audit `auto_registered` · second message from same stranger reuses the client · active client → message stored + assigned to an open batch · blocked client → nothing stored at all.* ✅ 6 tests
- [x] **3. Debouncer** — per-client timers, reset-on-touch, sweep for overdue open batches.
  *AC (fake timers): burst → one batch, closed once, measured from the LAST message · independent per-client windows · sweep closes an orphaned batch after simulated crash, leaves fresh ones open · sweep no-op when nothing overdue.* ✅ 4 tests
- [x] **4. Telegram adapter** — Grammy long polling; text messages → `InboundMessage` with raw payload; token validated at `start()`.
  *AC: typecheck + contract conformance; live behavior is the Verify checkpoint.* ✅ (missing-token boot fails with a clear error — verified)
- [x] **5. Composition root + clients CLI** — `buildApp()` boot sequence, graceful stop, periodic tick; `clients` CLI.
  *AC: app boots against the fake adapter in a test; a second boot on the same DB sweeps the orphaned batch; CLI runs against the dev DB.* ✅ 2 tests + manual
- [x] **6. Verify support** — runbook below. ✅

**Operator-found gap during Verify (2026-07-07):** restarting *within* the debounce window showed `swept 0` — correct (the window hadn't elapsed) — but the orphaned batch then had no timer and would have waited for the next 15-min tick. Fix: `Debouncer.rearm()` re-schedules timers for open-but-not-overdue batches with their *remaining* window time; runs at boot and each tick; never double-arms. +2 tests.

**Stage complete:** 77 tests green (14 new), typecheck clean. Awaiting operator Verify checkpoint (live Telegram — needs your dev bot token).

## Verify (operator checkpoint)

1. Put a dev bot token (from @BotFather) in `v2/.env` as `TELEGRAM_TOKEN=...`, then `npm start`.
2. Message the bot from your Telegram: watch the log — you're auto-registered `pending_verification`; `npm run clients -- list` shows you; the message row (with raw payload) is in `data/v2.sqlite`; **no batch exists** (you're gated).
3. `npm run clients -- verify <your-id>`, send a burst of 2–3 messages: after the debounce window (~3 min, configurable via `DEBOUNCE_MINUTES=0.1` for a fast demo) one batch flips `open → pending` in the DB.
4. Kill the process mid-window and restart: the sweep closes the orphaned batch — nothing lost.
5. `npm test` green throughout (Stage 0–2's 63 + this stage's suites).
