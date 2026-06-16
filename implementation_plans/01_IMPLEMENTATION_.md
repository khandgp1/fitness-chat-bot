# Phase 2 — State Model

> **Plan Index:** 01  
> **KICKSTART Reference:** Phase 2 of `KICKSTART.md`  
> **Goal:** Implement a typed, robust per-client state model with synchronous disk operations (flat JSON files) and sensible defaults.  
> **Exit Criteria:** `npx tsx src/state/testStore.ts` executes successfully, performing a complete client creation, serialization, deserialization, mutation, saving, reloading, and validation cycle with zero errors.

---

## Tech Decisions (Confirmed via /grill-me)

| Decision                  | Choice                             | Rationale                                                                                                                                          |
| :------------------------ | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Log Structures**        | Structured interfaces              | `GmLogEntry`, `PendingReviewEntry`, and `ClassificationLogEntry` are defined as strongly-typed objects containing ISO timestamps and audit fields. |
| **Storage Concurrency**   | Synchronous file system operations | Single-threaded Node.js synchronous block naturally prevents read-modify-write race conditions for the same client in our zero-ops prototype.      |
| **Verification Strategy** | Standalone test script             | Programmatic validation via `src/state/testStore.ts` run via `tsx` keeps dev setup zero-ops and lightweight.                                       |

---

## User Review Required

> [!NOTE]
> All design details have been aligned via the `/grill-me` process. The plan specifies standard Node.js synchronous operations (`fs.readFileSync`/`fs.writeFileSync`) for state persistence to guarantee simple and robust concurrency control.

---

## Open Questions

> [!NOTE]
> There are no remaining open questions for this phase.

---

## Proposed Changes

### State Model and Storage Component

---

#### [NEW] [schema.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/schema.ts)

Define the domain interfaces and type definitions for client states and logs.

- Define `ComplianceStatus` enum-like type (`'Compliant' | 'Miss' | 'Pending Review' | 'Unknown'`).
- Define `GmLogEntry` interface.
- Define `PendingReviewEntry` interface.
- Define `ClassificationLogEntry` interface.
- Define the main `ClientState` interface matching §7 of the spec.

---

#### [NEW] [store.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/store.ts)

Implement the store abstraction logic.

- Define storage path constants (e.g. resolve `data` directory relative to project root).
- Implement `clientExists(clientId: string): boolean`:
  - Returns true if the file `data/<clientId>.json` exists.
- Implement `loadClient(clientId: string): ClientState`:
  - Reads `data/<clientId>.json` synchronously.
  - Parses JSON content and returns typed `ClientState`.
  - Throws an error if the client doesn't exist.
- Implement `saveClient(state: ClientState): void`:
  - Ensures the `data/` directory exists (creates recursively if missing).
  - Serializes state object to JSON with 2-space formatting.
  - Writes to `data/<clientId>.json` synchronously.
- Implement `createClient(clientId: string, timezone: string): ClientState`:
  - Verifies if the provided timezone is a valid IANA timezone string using `Intl.DateTimeFormat`.
  - Instantiates a new `ClientState` object with the given client ID, timezone, and defaults:
    - `gm_received_today`: `false`
    - `compliance_status`: `'Unknown'`
    - `streak_count`: `0`
    - `current_response_level`: `0`
    - `window_position`: `0`
    - `responses_given`: `0`
    - `gm_log`: `[]`
    - `miss_log`: `[]`
    - `pending_review_log`: `[]`
    - `classification_log`: `[]`
  - Saves the new client using `saveClient(state)`.
  - Returns the newly created state.

---

#### [NEW] [testStore.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/testStore.ts)

Add a programmatic test suite to perform complete verification of the state persistence layer.

- Create a temporary client with ID `test-client-999` and timezone `America/New_York`.
- Verify default values are set correctly.
- Perform a round-trip save and load.
- Mutate various fields:
  - Add logs (`gm_log`, `classification_log`, `pending_review_log`).
  - Modify counters (`streak_count`, `window_position`, `responses_given`).
  - Change `compliance_status`.
- Save state, load again, and assert that all loaded fields match the mutated values.
- Clean up by deleting the temporary file `data/test-client-999.json`.
- Log success/failure messages to standard output.

---

## Verification Plan

### Automated Tests

We will run the following verification step:

- Run the manual test runner script:
  ```bash
  npx tsx src/state/testStore.ts
  ```
- Run formatting and linting:
  ```bash
  npm run lint
  npm run format
  ```

### Manual Verification

- Inspect the generated `data/` folder structure.
- Review one of the test JSON files output during execution (by pausing cleanup or viewing stdout logs) to confirm clean, pretty-printed JSON formatting.

---

## Progress Checklist

- [ ] Create `src/state/schema.ts` defining all state and log interfaces.
- [ ] Create `src/state/store.ts` with file storage read/write operations and auto-creation of `data/` directory.
- [ ] Create `src/state/testStore.ts` with round-trip validation and auto-cleanup.
- [ ] Run `npx tsx src/state/testStore.ts` and verify it succeeds.
- [ ] Run `npm run lint` and `npm run format` to ensure clean workspace.
