# Phase 4 — Compliance Logic and Midnight Scheduler

> **Plan Index:** 03  
> **KICKSTART Reference:** Phase 4 of `KICKSTART.md` (excluding 4c and 4d)  
> **Goal:** Implement the core compliance tracking logic (§4), pending review rules (§4.6), streak holding rules (§4.5), and an hourly-polled midnight transition scheduler (§4.4) using `node-cron`.  
> **Exit Criteria:** `npx tsx src/compliance/testCompliance.ts` executes successfully, verifying that all state transitions (compliant, miss, pending review, duplicate, multi-day catch-up) and the scheduler behavior operate exactly as specified.

---

## Tech Decisions (Aligned via /grill-me)

| Decision                        | Choice                             | Rationale                                                                                                                                                                      |
| :------------------------------ | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Downtime Resiliency**         | Reactive + Scheduled checks        | Ensures client state stays 100% correct even if the bot is down during a midnight boundary. Transitions are processed when states are loaded/modified, and caught up hourly.   |
| **Last Active Date Tracking**   | Add `last_active_date: string`     | A new field `last_active_date` (format `YYYY-MM-DD` in the client's local timezone) will be added to `ClientState` to explicitly track day boundaries.                         |
| **Duplicate GM Logging**        | Log to `classification_log` only   | Duplicate GMs will be recorded in the complete audit trail (`classification_log`), but will NOT be appended to `gm_log` to keep it clean of multiple daily check-ins.          |
| **Streak Holding Behavior**     | Resume on subsequent Compliant day | A pending review day keeps the streak from resetting. If the client checks in on the next day, the streak increments, ignoring past pending days for the active streak.        |
| **Scheduler Polling Frequency** | Hourly-level polling               | Runs a single `node-cron` job every hour at the top of the hour. It scans all clients, loads their state (which triggers the reactive date transition), and saves any updates. |

---

## User Review Required

> [!IMPORTANT]
>
> - We are introducing a new field `last_active_date?: string` to `ClientState` in [schema.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/schema.ts). If missing, it will automatically default to the client's current local date upon loading.
> - The scheduler will run every hour (`0 * * * *`) rather than every minute, which reduces resource utilization while guaranteeing correct transitions due to the reactive catch-up mechanism.

---

## Open Questions

> [!NOTE]
> All primary design decisions have been resolved via the `/grill-me` interview.

---

## Proposed Changes

### State Component

#### [MODIFY] [schema.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/schema.ts)

Add `last_active_date` to `ClientState`:

- `last_active_date?: string; // YYYY-MM-DD in client's local timezone`

#### [MODIFY] [store.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/store.ts)

Update storage operations to integrate with reactive day transitions:

- Import `transitionClientDays` and `getLocalDateStr` from `../compliance/compliance.js`.
- In `createClient`:
  - Set `last_active_date` to `getLocalDateStr(timezone)`.
- In `loadClient`:
  - Read client file.
  - Determine `currentLocalDate = getLocalDateStr(state.timezone)`.
  - Call `transitionClientDays(state, currentLocalDate)`.
  - If state was updated (e.g. `last_active_date` shifted or misses logged), save state back to file.
  - Return updated state.

---

### Compliance Component

#### [NEW] [compliance.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/compliance/compliance.ts)

Implement day transition and classification result handling:

- Implement `getLocalDateStr(timezone: string): string`:
  - Returns current date in `YYYY-MM-DD` using Swedish (`sv-SE`) locale format in the target timezone.
- Implement `getNextDateStr(dateStr: string): string`:
  - Helper to add exactly 1 day to a `YYYY-MM-DD` string in UTC to avoid DST offsets.
- Implement `transitionClientDays(state: ClientState, currentDate: string): ClientState`:
  - If `state.last_active_date` is missing, initialize it to `currentDate` and return.
  - If `state.last_active_date === currentDate`, return state.
  - While `tempDate !== currentDate` (looping from `state.last_active_date` up to the day before `currentDate`):
    - Process the end of `tempDate`:
      - If `state.gm_received_today === true`: day is Compliant (already tracked).
      - If `state.gm_received_today === false`:
        - If `state.compliance_status === 'Pending Review'`: do NOT reset streak or log miss (holds).
        - Else: log as a Miss. Set `compliance_status: 'Miss'`, reset `streak_count: 0`, and append `tempDate` to `miss_log`.
    - Prepare state for the next day:
      - Set `state.gm_received_today = false`.
      - Set `state.compliance_status = 'Unknown'`.
      - Set `tempDate = getNextDateStr(tempDate)`.
  - Set `state.last_active_date = currentDate`.
  - Return updated state.
- Implement `handleGmResult(state: ClientState, result: ClassificationResult | null, messageText: string): ClientState`:
  - Ensure the client state is transitioned to today's date first.
  - If `result === null` (failure/timeout):
    - If `state.gm_received_today === false`:
      - Set `state.compliance_status = 'Pending Review'`.
      - Add entry to `pending_review_log`.
  - If `result.is_valid_gm === true`:
    - If `state.gm_received_today === true` (duplicate):
      - Log to `classification_log` with a custom reasoning message showing it was a duplicate.
    - Else (new compliant day):
      - Set `state.gm_received_today = true`.
      - Set `state.compliance_status = 'Compliant'`.
      - Increment `state.streak_count += 1`.
      - Clear any entries in `pending_review_log` for the current date.
      - Add entry to `gm_log` and `classification_log`.
  - If `result.is_valid_gm === false` (non-GM message):
    - Log to `classification_log` only. Do not change compliance status or streak.
  - Save the updated client state and return it.

---

### Scheduler Component

#### [NEW] [midnight.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/scheduler/midnight.ts)

Implement the hourly transition checking scheduler:

- Import `cron` from `node-cron`.
- Import `loadClient`, `saveClient` from `../state/store.js` and filesystem utilities.
- Implement `startMidnightScheduler(): void`:
  - Schedule a job using `cron.schedule('0 * * * *', ...)` to run at the top of every hour.
  - Inside the job:
    - List all files in the `data` directory matching `*.json`.
    - Extract `clientId` from each filename.
    - For each client, call `loadClient(clientId)`. This automatically triggers the timezone-specific reactive transition and writes back to disk if any changes occurred.
    - Log execution status and count of processed clients.

---

### Verification Component

#### [NEW] [testCompliance.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/compliance/testCompliance.ts)

Add a standalone verification script to validate all compliance flows:

- Test 1: `getLocalDateStr` and `getNextDateStr` formats.
- Test 2: `transitionClientDays` state transitions:
  - Transition a client from Compliant state to a Miss (date change with `gm_received_today: false`).
  - Transition a client with `Pending Review` status (verify streak holds and no Miss logged).
  - Catch up over a 3-day downtime gap (verify multiple Misses logged, streak reset).
- Test 3: `handleGmResult` conditions:
  - Verify valid check-in increments streak and resolves Pending Review.
  - Verify duplicate check-in does not change streak or append to `gm_log`.
  - Verify invalid check-in doesn't affect compliance.
  - Verify LLM failure (`null` result) sets state to `Pending Review`.
- Test 4: Scheduler integration:
  - Create mock client state files in `data/` and verify that loading them catches them up to the current date.

---

## Verification Plan

### Automated Tests

- Execute the automated test script:
  ```bash
  npx tsx src/compliance/testCompliance.ts
  ```
- Check linting and formatting:
  ```bash
  npm run lint
  npm run format
  ```

---

## Progress Checklist

- [x] Modify `src/state/schema.ts` to add `last_active_date`.
- [x] Implement `src/compliance/compliance.ts` containing timezone date utilities, transition checks, and result handlers.
- [x] Update `src/state/store.ts` to import and run `transitionClientDays` inside `loadClient` and `createClient`.
- [x] Implement `src/scheduler/midnight.ts` to poll client folders hourly.
- [x] Create `src/compliance/testCompliance.ts` containing the suite of compliance and transition tests.
- [x] Run `npx tsx src/compliance/testCompliance.ts` to verify correct behavior.
- [x] Run `npm run lint` and `npm run format` to ensure code consistency.
