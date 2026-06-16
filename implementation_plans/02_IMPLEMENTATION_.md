# Phase 3 — LLM Classifier

> **Plan Index:** 02  
> **KICKSTART Reference:** Phase 3 of `KICKSTART.md`  
> **Goal:** Implement the Section 3 classification engine using Claude Haiku 4.5 with forced tool use against the Section 3.4 output schema.  
> **Exit Criteria:** `npx tsx src/classifier/testClassifier.ts` executes successfully, verifying that valid greetings return `is_valid_gm: true`, invalid messages return `is_valid_gm: false`, and API failures/timeouts return `null`.

---

## Tech Decisions (Confirmed via /grill-me)

| Decision                  | Choice                          | Rationale                                                                                                                                                                        |
| :------------------------ | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API Timeout / Retries** | 10-second timeout, 0 retries    | Keeps the Telegram response loop responsive and predictable. Transient failures fail fast and safely default to Pending Review.                                                  |
| **Test Verification**     | Real API calls only             | Programmatic verification via `testClassifier.ts` requires a valid `ANTHROPIC_API_KEY` to guarantee our prompts and schemas are correctly validated against the live Claude API. |
| **Client Initialization** | Internal / Singleton            | The Anthropic client is initialized once inside `src/classifier/classify.ts` from environment variables, keeping imports clean and simple.                                       |
| **Schema Enforcement**    | Forced tool use (`classify_gm`) | Guarantees structured JSON input blocks matching `{ is_valid_gm: boolean, reasoning: string }`, eliminating schema-drift parsing issues.                                         |

---

## User Review Required

> [!NOTE]
> All design decisions have been aligned via the `/grill-me` process. The plan uses live Anthropic API calls for verification. Please ensure that a valid `ANTHROPIC_API_KEY` is present in your local `.env` file before running the test script.

---

## Open Questions

> [!NOTE]
> There are no remaining open questions for this phase.

---

## Proposed Changes

### LLM Classifier Component

---

#### [NEW] [classify.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/state/schema.ts)

Implement the classification logic using Claude Haiku 4.5.

- Import `Anthropic` from `@anthropic-ai/sdk`.
- Read `ANTHROPIC_API_KEY` from `process.env`. Throw a clear error if it is not configured during initialization.
- Initialize the `Anthropic` client singleton with a `10000ms` timeout and `0` retries.
- Define `ClassificationResult` interface:
  ```typescript
  export interface ClassificationResult {
    is_valid_gm: boolean;
    reasoning: string;
  }
  ```
- Define `gmTool` specification matching Section 3.4:
  - `name`: `'classify_gm'`
  - `description`: `'Classify whether a message is a valid GM check-in'`
  - `input_schema` properties: `is_valid_gm` (boolean), `reasoning` (string)
- Implement `classifyMessage(message: string): Promise<ClassificationResult | null>`:
  - Call `anthropic.messages.create` with:
    - `model: 'claude-haiku-4-5'`
    - `max_tokens: 256`
    - `system`: System prompt containing Section 3.2's principles and Section 3.3's examples as few-shot grounding
    - `messages`: Single user message with the client text input
    - `tools`: `[gmTool]`
    - `tool_choice`: `{ type: 'tool', name: 'classify_gm' }`
  - Retrieve the first content block from the response where `type === 'tool_use'`.
  - Cast the `input` field of the tool block to `ClassificationResult`.
  - Wrap the entire operation in a `try/catch` block. Catch all timeout, network, schema, and API errors, log the details to `console.error`, and return `null` (never throw).

---

#### [NEW] [testClassifier.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/classifier/testClassifier.ts)

Add a standalone verification script to test classification against the live Claude API.

- Verify `ANTHROPIC_API_KEY` is configured in `process.env`. Exit with code 1 if it is missing.
- Define a list of test cases based on Section 3.3:
  - `"GM"` -> expected: `is_valid_gm: true`
  - `"Hey, good morning, let's go"` -> expected: `is_valid_gm: true`
  - `"Goof morning!"` -> expected: `is_valid_gm: true`
  - `"Can we talk about my macros?"` -> expected: `is_valid_gm: false`
  - `"morning, ready to work"` -> expected: `is_valid_gm: false`
- Run each test case through `classifyMessage` and assert the value of `is_valid_gm` matches expectation.
- Log reasoning and classification status for each.
- Test error path: Temporarily override `process.env.ANTHROPIC_API_KEY` to an invalid value or construct a secondary failing client call, call `classifyMessage`, and assert that it gracefully returns `null` instead of throwing.
- Report pass/fail summary. Exit with code 0 on success, or 1 on failure.

---

## Verification Plan

### Automated Tests

- Run the manual test runner script:
  ```bash
  npx tsx src/classifier/testClassifier.ts
  ```
- Run formatting and linting check:
  ```bash
  npm run lint
  npm run format
  ```

---

## Progress Checklist

- [ ] Create `src/classifier/classify.ts` with the Anthropic client setup and forced tool use `classifyMessage` implementation.
- [ ] Create `src/classifier/testClassifier.ts` with live test assertions and error-path checking.
- [ ] Verify that running `npx tsx src/classifier/testClassifier.ts` succeeds for all test cases.
- [ ] Run `npm run lint` and `npm run format` to ensure clean code.
