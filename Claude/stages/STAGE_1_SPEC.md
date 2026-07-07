# Stage 1 — Persistence Core

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 1
**Goal:** The seven repositories (Phase 2 §5) as working, tested code on the Stage 0 foundation. Repositories expose **domain operations, not row CRUD**; all multi-step writes are transactions; every state change lands an audit event. Zero pipeline/agent/UI logic.

---

## Design Notes

- **Factory functions, not classes** (matches `createClock`): `createClientRepo(db, clock)` returns a typed object. Repos share one `Db` handle; cross-repo transactions use a shared `withTransaction(db, fn)` helper.
- **Policy stays out.** MessageRepo provides batch *primitives* (open/close/mark-processed); the debounce policy that decides *when* to call them is Stage 3. ComplianceRepo is a **shell**: reads, day primitives, and the streak-derivation query — the state machine that calls them is Stage 2. DraftRepo provides the freshness *check*; the send flow that composes it with an adapter is Stage 5.
- **IDs:** `ulid` package (tiny, zero-dep) behind `newId()` in `repos/ids.ts`.
- **Time:** repos never touch `Date` — they take `Clock` and stamp `created_at`/`resolved_at` from it, so simulated time flows into rows automatically.
- **Streak derivation (P2-4):** `currentStreak = streak_after of the most recent day where streak_after IS NOT NULL`, else 0. Pending-review days have NULL `streak_after` and are naturally skipped — the "hold" falls out of the query.
- **NarrativeStore spans both media (D16):** content = `<narrativesDir>/<clientId>.md`; watermark/flags = SQLite. Writes go through `quickEdit`, which writes the file and commits to git in the narratives directory (initializing a git repo there on first write if absent — Stage 7 formalizes the directory's setup; Stage 1 makes writes safe regardless).
- **PromptStore is read-only** and returns `{content, gitHash}` where `gitHash` is the git *blob* hash (`git hash-object`) — content-addressed, works whether or not the file is committed yet.
- **Audit rows are never deleted** — `AuditRepo` has no delete surface at all; client reset/delete leaves audit history intact (Phase 2 §2.6).

## File List

```
v2/src/repos/
├── ids.ts               # newId(): ulid
├── tx.ts                # withTransaction(db, fn)
├── clientRepo.ts
├── messageRepo.ts
├── complianceRepo.ts    # shell
├── draftRepo.ts
├── narrativeStore.ts
├── promptStore.ts
└── auditRepo.ts
v2/test/
├── helpers/testDb.ts    # temp-file DB + migrations + fixed clock fixture
├── clientRepo.test.ts
├── messageRepo.test.ts
├── complianceRepo.test.ts
├── draftRepo.test.ts
├── narrativeStore.test.ts
└── promptAudit.test.ts
```

New dependency: `ulid`.

## Key Interfaces (indicative)

```ts
// clientRepo.ts — lifecycle is the domain, not UPDATE clients SET …
interface ClientRepo {
  create(input: { displayName: string; timezone: string }): Client;      // → pending_verification
  get(id: string): Client | undefined;
  listByStatus(status?: ClientStatus): Client[];
  registerIdentity(clientId: string, channel: string, externalId: string, handle?: string): void;
  findByIdentity(channel: string, externalId: string): Client | undefined;
  verify(id: string): void;                                              // + audit event
  block(id: string): void;                                               // + audit event
  update(id: string, patch: { displayName?: string; timezone?: string }): void;
  setLastReconciledDate(id: string, date: string): void;
  reset(id: string): void;   // one transaction: wipe owned rows, keep client+identities; audit
  delete(id: string): void;  // one transaction: cascade delete; audit survives (no FK)
}

// messageRepo.ts — messages + batch primitives (policy in Stage 3)
interface MessageRepo {
  appendInbound(input: { clientId: string; text: string; channelMessageRef?: string; rawPayload?: string }): Message;
  appendOutbound(input: { clientId: string; text: string; draftId?: string }): Message;
  list(clientId: string, opts?: { beforeId?: string; limit?: number }): Message[];  // newest-first
  latestInbound(clientId: string): Message | undefined;
  openBatch(clientId: string): Batch;                    // creates or returns the open batch
  assignToBatch(messageId: string, batchId: string): void;
  closeBatch(batchId: string): void;                     // open → pending
  markBatchProcessed(batchId: string, r: { primaryIntent: Intent; routerConfidence: number; needsResponse: boolean }): void;
  dismissBatch(batchId: string): void;                   // + audit event
  listBatches(clientId: string, status?: BatchStatus): Batch[];
}

// complianceRepo.ts — SHELL (state machine arrives Stage 2 behind this interface)
interface ComplianceRepo {
  getDay(clientId: string, date: string): ComplianceDay | undefined;
  listDays(clientId: string, fromDate: string, toDate: string): ComplianceDay[];
  currentStreak(clientId: string): number;               // derivation query (P2-4)
  upsertDay(day: ComplianceDay): void;                   // primitive for Stage 2
  setFollowupState(clientId: string, date: string, s: FollowupState): void;  // + audit event
}

// draftRepo.ts — lifecycle + the freshness primitive (send flow composes in Stage 5)
interface DraftRepo {
  create(input: { clientId: string; coversThroughMessageId: string; draftText: string;
                  responseType: ResponseType; confidence?: number; autonomyLevel?: number }): Draft;
  getActive(clientId: string): Draft | undefined;
  list(clientId: string, status?: DraftStatus): Draft[];
  isFresh(draft: Draft): boolean;        // no inbound newer than covers_through_message_id
  markStale(id: string): void;
  markRejected(id: string): void;        // + audit event
  markSent(id: string, finalText: string): void;  // status→sent; + audit event
}

// narrativeStore.ts — files + SQLite behind one interface
interface NarrativeStore {
  read(clientId: string): { content: string | undefined; path: string };
  quickEdit(clientId: string, content: string, actor: 'operator'): void;  // file write + git commit + audit
  getWatermark(clientId: string): string | undefined;
  setWatermark(clientId: string, ts: string): void;      // clears flags created before ts
  addFlag(clientId: string, note: string, createdBy: 'agent' | 'operator'): void;
  listUnclearedFlags(clientId: string): NarrativeFlag[];
  stalenessScore(clientId: string): { flags: number; replyWorthyBatches: number };
}

// promptStore.ts — read-only at runtime
interface PromptStore {
  get(name: string): { content: string; gitHash: string };  // fresh read every call
}

// auditRepo.ts — append + query; no delete surface
interface AuditRepo {
  event(e: { clientId?: string; actor: 'operator' | 'system'; action: string; details?: unknown }): void;
  llmCall(c: LlmCallInput): void;
  listEvents(opts?: { clientId?: string; limit?: number }): AuditEvent[];
  listLlmCalls(opts?: { clientId?: string; limit?: number }): LlmCall[];
}
```

## Tasks

- [x] **1. Shared plumbing** — `ulid` dep, `ids.ts` (monotonic — ORDER BY id is insertion order), `tx.ts`, `types.ts` *(added: shared domain types)*, `test/helpers/testDb.ts`.
  *AC: helper fixture used by every suite; `withTransaction` rolls back on throw (test).* ✅
- [x] **2. ClientRepo** — lifecycle transitions, identity mapping, reset/delete as single transactions with audit events. *(Implementation note: reset/delete unlink the messages↔drafts FK cycle before wiping.)*
  *AC: tests — create→verify→block flow with audit rows; `findByIdentity` round-trip; reset wipes owned rows but keeps client+identities+audit; delete cascades but audit survives; both atomic (partial-failure leaves nothing half-done).* ✅
- [x] **3. MessageRepo** — append inbound/outbound, paged listing, batch primitives.
  *AC: tests — newest-first paging with `beforeId`; one open batch per client (openBatch returns existing); batch status walk open→pending→processed with router fields; dismiss stamps `dismissed_at` + audit.* ✅
- [x] **4. ComplianceRepo shell** — day reads, upsert primitive, streak derivation, followup state.
  *AC: tests — `currentStreak` returns streak_after of latest resolved day, skips NULL (pending hold), 0 when empty; followup transitions audited.* ✅
- [x] **5. DraftRepo** — lifecycle + freshness primitive; DB-enforced one-active surfaced as typed `ActiveDraftExistsError`. *(Bug found by tests: SQLite reports the partial index as a column-list message, not the index name — detection fixed.)*
  *AC: tests — second `create` while one active throws typed error; `isFresh` false after a newer inbound lands; markSent stores `final_text` and stamps `resolved_at`; rejected/stale drafts retained.* ✅
- [x] **6. NarrativeStore** — file+git content path, watermark/flags, staleness query.
  *AC: tests — quickEdit writes file and creates a git commit in a temp narratives dir (repo auto-init); watermark set clears only flags at/before it; stalenessScore counts uncleared flags + reply-worthy batches since watermark; identical rewrite creates no empty commit.* ✅
- [x] **7. PromptStore + AuditRepo** — content+blob-hash reads; append/query audit surfaces.
  *AC: tests — `gitHash` changes when content changes, stable when not; missing prompt file throws a clear error; audit queries filter by client and respect limit.* ✅

**Stage complete:** 45 tests green (18 Stage 0 + 27 new), typecheck clean. Walkthrough script added: `v2/src/cli/stage1-walkthrough.ts`. Awaiting operator Verify checkpoint.

## Verify (operator checkpoint)

`npm test` green (Stage 0's 18 + this stage's suites). Then a scripted walkthrough (I'll provide the commands): seed a client via a small REPL script, append messages, open/close a batch, create a draft, watch a second draft get refused, quick-edit a narrative and see the git commit in the narratives directory, then `reset` the client and confirm messages are gone but audit rows remain — all against a dev DB you can open and inspect.
