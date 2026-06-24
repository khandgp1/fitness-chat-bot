# 16 — Reasoning Memory for Personalized GM Classification

## Goal

Allow the operator to curate past LLM classification reasoning entries and inject them as few-shot examples into future GM classification calls, personalizing the LLM's behavior over time.

## Design Decisions (resolved via grill-me)

| Decision           | Choice                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry Shape        | `message` + `is_valid_gm` (operator's definitive answer) + `reasoning` (LLM's original) + optional `override_reasoning` (operator's custom text) |
| Scope              | Global — shared across all clients                                                                                                               |
| Storage            | `data/reasoning_memory.json` — flat JSON file, consistent with existing data pattern                                                             |
| Management         | Manual file editing — no dashboard UI                                                                                                            |
| Entry Cap          | No cap — all entries injected into the prompt                                                                                                    |
| Prompt Injection   | Appended after existing illustrative examples as a labeled "Approved Past Classifications" section                                               |
| LLM Format         | JSON for storage; natural-language formatting at injection time                                                                                  |
| Error Handling     | Hard fail if file is missing or contains malformed JSON — file must always exist                                                                 |
| Seed File          | Ships with one example entry + schema-comment field explaining each property                                                                     |
| Data Wipe Behavior | `reasoning_memory.json` is untouched during `dev:reset` — it represents operator preferences, not client data                                    |

## Proposed Changes

### 1. Reasoning Memory Schema & Storage

#### [NEW] [reasoningMemory.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/classifier/reasoningMemory.ts)

New module responsible for loading and formatting reasoning memory entries:

- **`ReasoningMemoryEntry` interface**:

  ```ts
  interface ReasoningMemoryEntry {
    _comment?: string; // Optional schema documentation (ignored by code)
    message: string; // The original classified message
    is_valid_gm: boolean; // Operator's definitive classification
    reasoning: string; // LLM's original reasoning
    override_reasoning?: string; // Operator's custom reasoning (if provided)
  }
  ```

- **`loadReasoningMemory(): ReasoningMemoryEntry[]`**:
  - Reads `data/reasoning_memory.json` from the data directory.
  - Throws on missing file or malformed JSON (hard fail).
  - Validates each entry has `message`, `is_valid_gm`, and `reasoning` fields.
  - Filters out entries that have a `_comment` key but no `message` key (pure comment entries).

- **`formatReasoningForPrompt(entries: ReasoningMemoryEntry[]): string`**:
  - Converts entries into natural-language lines for prompt injection.
  - Uses `override_reasoning` if present, otherwise falls back to `reasoning`.
  - Returns empty string if no entries (no section added to prompt).
  - Format:
    ```
    Approved Past Classifications (use these as authoritative reference):
    - "G" → is_valid_gm: true | Reasoning: A single 'G' is a minimalist shorthand for GM...
    - "morning" → is_valid_gm: false | Reasoning: A bare 'morning' without the 'good morning' framing...
    ```

---

### 2. Classifier Integration

#### [MODIFY] [classify.ts](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/src/classifier/classify.ts)

- Import `loadReasoningMemory` and `formatReasoningForPrompt` from `reasoningMemory.ts`.
- In `classifyMessage()`, before calling the Anthropic API:
  1. Load reasoning memory entries via `loadReasoningMemory()`.
  2. Format them via `formatReasoningForPrompt()`.
  3. Append the formatted string to the base `systemPrompt` to build the final prompt.
- The base system prompt (hardcoded illustrative examples) remains unchanged.

---

### 3. Seed Data File

#### [NEW] [reasoning_memory.json](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/data/reasoning_memory.json)

Ships with one example entry plus a schema-comment entry:

```json
[
  {
    "_comment": "SCHEMA: message (string) = the original message | is_valid_gm (boolean) = YOUR definitive classification | reasoning (string) = the LLM's original reasoning | override_reasoning (string, optional) = your custom reasoning to replace the LLM's"
  },
  {
    "message": "G",
    "is_valid_gm": true,
    "reasoning": "A single 'G' is a minimalist abbreviation/shorthand for 'GM' (good morning). In a casual, text-based context, this reasonably qualifies as a valid daily check-in.",
    "override_reasoning": null
  }
]
```

---

### 4. Git Tracking

#### [MODIFY] [.gitignore](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/.gitignore)

- Ensure `data/reasoning_memory.json` is **not** gitignored (it should be committed as part of operator config).
- Verify current `.gitignore` rules don't accidentally exclude it.

---

## Verification Plan

### Automated Checks

- Run `npm run build` to verify TypeScript compiles successfully.
- Run `npm run lint` and `npm run format` to check for style/format issues.

### Manual Verification

- Start the server with `npm run dev`.
- Send a webhook message and verify console output shows the approved entries were injected into the system prompt (add a log line showing the final prompt length or entry count).
- Delete `data/reasoning_memory.json` and confirm the classifier throws an error (hard fail).
- Put malformed JSON in the file and confirm it throws.
- Restore the valid file and confirm classification works normally.

---

## Progress Checklist

- [x] Create `src/classifier/reasoningMemory.ts` with schema, loader, and formatter
- [x] Create `data/reasoning_memory.json` seed file with example entry
- [x] Modify `src/classifier/classify.ts` to integrate reasoning memory into system prompt
- [x] Verify `.gitignore` doesn't exclude the reasoning memory file
- [x] Build and lint check (`npm run build`, `npm run lint`)
- [x] Manual verification of prompt injection, hard-fail behavior, and end-to-end classification
