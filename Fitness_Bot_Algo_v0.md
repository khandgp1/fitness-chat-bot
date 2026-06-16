# GM Ritual Algorithm
## Document Type: Algorithm Specification
## Version: 0.5
## Status: Implementation Configuration Added — LLM (Claude Haiku 4.5) and Development Channel (Telegram) Specified; Production Channel Still Open
## Scope: GM Ritual Only — Core Logic Unchanged from v0.4; Implementation Configuration Added

---

## Version Changelog — v0.4 → v0.5

**Resolved this version:**
- LLM for Section 3 classification confirmed: **Claude Haiku 4.5**, via forced tool use against the Section 3.4 output schema — see Section 10.1
- Development/testing channel confirmed: **Telegram** — see Section 10.2

**Explicitly scoped:**
- The Telegram decision resolves a *development/testing* channel only. It does **not** resolve Open Decision #6 (production GM channel — Session Starter, Section 4), which remains open. See Section 8 note and Section 9.

**Unchanged:**
- Sections 3–7 (Input Detection, Compliance Logic, Response Logic, Content Sources, Internal State Model) are unchanged from v0.4. Section 3.2's classification guidance remains authoritative and model-agnostic, per v0.4 Section 9 — Section 10.1 documents a specific model choice *for* that guidance, not a change *to* it.

**Implication:** The GM ritual algorithm now has a concrete, buildable reference configuration — a model, a schema-enforcement approach, and a channel to develop and test against — without requiring the production channel decision (Open Decision #6) to be made first.

---

## 1. Purpose

This document specifies the logic for an AI chatbot to receive, classify, track, and respond to a client's daily GM message.

The GM ritual is the foundational behavior anchor of the coaching system. As of v0.3, message classification (Section 3) is performed by an LLM rather than deterministic string rules. As of v0.4, the classification guidance itself (Section 3.2) is principle-based rather than an exhaustive rule-set — the classifier's reasonable judgment is authoritative for cases that don't cleanly fit. Compliance tracking (Section 4), response rate logic (Section 5), and content delivery (Section 6) build on the classifier's output and are otherwise unchanged. As of v0.5, Section 10 specifies a concrete LLM (for Section 3's classification) and a development/testing channel — both are implementation configuration that builds on, and does not modify, the logic in Sections 3–7.

---

## 2. Definitions

| Term | Definition |
|---|---|
| **GM** | A message from the client classified as valid per Section 3 — confirming presence and identity adherence for the day |
| **Calendar Day** | A 24-hour period from 12:00:00 AM to 11:59:59 PM in the client's local timezone |
| **Compliant Day** | A calendar day in which at least one valid GM was confirmed |
| **Miss** | A calendar day in which no valid GM was confirmed by 11:59:59 PM, AND the day is not in Pending Review status |
| **Pending Review** | A calendar day in which a classification attempt failed and no valid GM has otherwise been confirmed — see Section 4.6 |
| **Streak** | Count of consecutive compliant days. Internal only. Never surfaced to client. Holds (does not increment or reset) on Pending Review days. |
| **Response Rate Level** | The current ratio of GMs that trigger a bot response (see Section 5) |
| **Response Window** | A rolling set of 5 consecutive GMs used to govern response delivery |
| **Approved Response Library** | External document containing all approved bot response messages for compliant GMs |
| **Approved Motivational Library** | External document containing all approved motivational messages |

---

## 3. Input Detection Logic — LLM-Based Classification

### 3.1 Classification Task

On receiving a client message, the system submits it to an LLM for classification against the guidance in Section 3.2. The classifier returns a structured result (Section 3.4), which is used to update compliance state (Section 4).

Section 3.2 is deliberately guidance-based rather than an exhaustive rule list. Model selection, prompting approach, and configuration are implementation details and are not prescribed here — the guidance is authoritative regardless of how it is implemented. **As of v0.5, a specific implementation is documented in Section 10.1; this remains a configuration choice layered on top of the guidance below, not a replacement for it.**

### 3.2 Classification Guidance

A valid GM is a message that functions as the client's daily check-in — in the spirit of "GM" or "good morning."

The classifier should account for:
- **Typos and phrasing variation** — minor misspellings or natural variants of "GM" / "good morning" should be recognized as such (e.g., "Goof morning," "gm!!1," "G'morning")
- **Position** — the greeting may appear anywhere in the message, not only at the start ("Quick GM, let's go" counts)
- **Repetition** — repeated greetings don't invalidate ("GM GM")

**General guidance, not a hard rule:** "GM" and "good morning" represent the standard. A bare "morning" on its own — without the fuller "good morning" framing — generally falls short of that standard. This is guidance for judgment, not an exhaustive list of exclusions. The classifier should weigh the whole message and reach a reasonable conclusion, including for phrasings that sit between categories.

Messages that don't reasonably represent a check-in — questions, comments, unrelated content — are not valid GMs.

**Borderline phrasings are expected and do not require pre-resolution.** The classifier's judgment, applied consistently, is the specification.

### 3.3 Illustrative Examples

*The following are illustrative, not exhaustive. They calibrate the kind of judgment expected — they are not a rule list to be matched against.*

| Message | Illustrative Read |
|---|---|
| "GM" | Valid |
| "Hey, good morning, let's go" | Valid — greeting appears anywhere in the message |
| "Goof morning!" | Valid — recognizable typo of "good morning" |
| "Can we talk about my macros?" | Invalid — not a check-in |
| "morning, ready to work" | Likely invalid — "morning" alone generally falls short of the standard |
| "Mornin'!" | Judgment call — illustrates the kind of borderline case intentionally left to the classifier |

### 3.4 Output Schema

The classifier returns a structured result per message:

```
{
  "is_valid_gm": true | false,
  "reasoning": "<brief explanation>"
}
```

- `is_valid_gm` — the binary signal consumed by Section 4
- `reasoning` — brief explanation in the classifier's own words, logged for audit and dispute resolution (Section 7)

### 3.5 Non-GM Messages

A message classified `is_valid_gm: false` is a non-GM message.

**Non-GM message handling: [DEFERRED — Out of scope for this version, unchanged from v0.2]**

### 3.6 Classification Failure Handling

A classification **fails** if the LLM call returns no response, an error, a timeout, or output that does not conform to the schema in 3.4.

On failure, the message is **not** classified as valid or invalid. The calendar day enters Pending Review status — see Section 4.6.

Retry policy (if any) is an implementation detail and does not change this logic — only the final unresolved state, after any retries, triggers 4.6.

*Note: this section addresses infrastructure-level failures (no usable classifier output at all) — a different concern from the content-level judgment calls in 3.2/3.3, and is unaffected by the v0.4 simplification. Section 10.1 documents how v0.5's chosen implementation (forced tool use) substantially narrows which failures are even possible here.*

---

## 4. Compliance Logic

### 4.1 Calendar Day Definition
- A calendar day runs from 12:00:00 AM to 11:59:59 PM, defined in the client's local timezone (confirmed v0.2 — unchanged)

### 4.2 Compliant Day
A calendar day is marked **compliant** when at least one message that day is classified `is_valid_gm: true`.

### 4.3 Duplicate GM Handling
If a valid GM is received and the current calendar day is already marked compliant:
- Log the duplicate message with timestamp
- Do not trigger a response
- Do not alter streak count
- Take no further action

*(Unchanged from v0.2.)*

### 4.4 Miss Detection

At 11:59:59 PM on any calendar day:

- If at least one valid GM was confirmed for the day → the day is Compliant (4.2). No further action.
- If no valid GM was confirmed, **and** the day has no Pending classification (4.6) → the day is logged as a **Miss**. Streak resets to 0.
- If no valid GM was confirmed, **and** the day has at least one Pending classification (4.6) → the day remains in **Pending Review** past midnight. It is **not** logged as a Miss, and streak does not reset.

**Miss response behavior: [DEFERRED — Blocked by cut threshold decision, unchanged from v0.2]**

### 4.5 Streak Tracking
- Streak counter increments by 1 on each Compliant day
- Streak counter resets to 0 on each Miss
- Streak counter **holds** — neither increments nor resets — for any day in Pending Review status, until that day resolves to Compliant or Miss
- Streak count is never surfaced to the client under any circumstance

### 4.6 Pending Review

**Trigger:** A classification attempt fails (3.6), and no valid GM has otherwise been confirmed for that calendar day.

**Effect:**
- The day's `compliance_status` (Section 7) is set to `Pending Review`
- The failed message is logged in `pending_review_log` (Section 7)
- Streak holds (4.5)
- The day is not logged as a Miss at 11:59:59 PM (4.4)

**Natural resolution:** If any message received that same calendar day is independently classified `is_valid_gm: true` (whether before or after the failure), the day immediately becomes Compliant (4.2), and the corresponding `pending_review_log` entry for that day is cleared.

**Unresolved Pending days:** If no later message that day resolves the status, the day remains Pending Review indefinitely. Resolution beyond natural resolution (above) requires a separate review/override process — **not specified in this document**. See Sections 8 and 9.

**Pending Review does not, by itself, trigger any cut-threshold, miss-notification, or miss-response logic** — all of which remain out of scope per Section 8. It is a neutral holding state.

*(Unchanged from v0.3 — this addresses infrastructure-level classification failures, a separate concern from the content-judgment simplification in v0.4.)*

---

## 5. Response Logic

### 5.1 Response Rate Levels

The algorithm operates at one of four response rate levels. The current level determines what proportion of valid GMs trigger a bot response.

| Level | Label | Response Rate | GMs Responded Per Window of 5 |
|---|---|---|---|
| Level 0 | Full Feedback | 5/5 | All 5 |
| Level 1 | Early Taper | 3/5 | 3 of 5 |
| Level 2 | Mid Taper | 2/5 | 2 of 5 |
| Level 3 | Minimal Feedback | 1/5 | 1 of 5 |

**Note on Level 0:** ✅ **Confirmed (v0.2).** Level 0 (5/5) is the active starting state for every client. Every valid GM receives a response while the client is at Level 0.

**Level Activation Triggers: [DEFERRED — Pending phase transition decisions]**

---

### 5.2 Response Selection Mechanic

**Design Principle:** Response delivery must be unpredictable to the client. The exact ratio must be maintained over time. Both requirements are satisfied through conditional probability within a rolling 5-GM window.

**The algorithm maintains two counters per client at all times:**
- `window_position` — Current position within the active 5-GM window (values 1–5)
- `responses_given` — Number of responses already sent within the current window

---

**On each valid GM received, execute the following sequence:**

```
STEP 1
Increment window_position by 1.

STEP 2
Calculate:
  remaining_gms    = 6 - window_position
  remaining_needed = target_responses - responses_given

  Where target_responses is defined by the current Response Rate Level:
    Level 0 → target_responses = 5
    Level 1 → target_responses = 3
    Level 2 → target_responses = 2
    Level 3 → target_responses = 1

STEP 3
  response_probability = remaining_needed / remaining_gms

STEP 4
Generate a random float between 0.00 and 1.00.

STEP 5
  If random_float < response_probability:
    → Pull one message at random from the Approved Response Library
    → Send message to client
    → Increment responses_given by 1

  If random_float ≥ response_probability:
    → Send no response
    → Take no action

STEP 6
  If window_position = 5:
    → Reset window_position to 0
    → Reset responses_given to 0
    → New window begins on next valid GM received
```

---

**Why This Mechanic Works:**

When responses have already been delivered in a window, probability of responding to the next GM decreases. When responses are still owed and few GMs remain in the window, probability rises — up to 100% on the final GM if the full quota has not yet been met.

From the client's perspective, response timing is unpredictable and non-patterned. Across any 5-GM window, the exact ratio is guaranteed.

---

**Worked Example — Level 1 (3 responses per 5 GMs):**

| GM # | window_position | remaining_gms | remaining_needed | probability | outcome |
|---|---|---|---|---|---|
| 1 | 1 | 5 | 3 | 3/5 = 60% | responded |
| 2 | 2 | 4 | 2 | 2/4 = 50% | no response |
| 3 | 3 | 3 | 2 | 2/3 = 67% | responded |
| 4 | 4 | 2 | 1 | 1/2 = 50% | no response |
| 5 | 5 | 1 | 1 | 1/1 = 100% | responded (forced) |

Window resets. Exactly 3 responses delivered. Client experienced no discernible pattern.

---

**Worked Example — Level 2 (2 responses per 5 GMs):**

| GM # | window_position | remaining_gms | remaining_needed | probability | outcome |
|---|---|---|---|---|---|
| 1 | 1 | 5 | 2 | 2/5 = 40% | no response |
| 2 | 2 | 4 | 2 | 2/4 = 50% | responded |
| 3 | 3 | 3 | 1 | 1/3 = 33% | no response |
| 4 | 4 | 2 | 1 | 1/2 = 50% | no response |
| 5 | 5 | 1 | 1 | 1/1 = 100% | responded (forced) |

Window resets. Exactly 2 responses delivered.

---

## 6. Content Sources

### 6.1 Approved Response Library
When a response is triggered, the algorithm selects one message at random from the Approved Response Library.

- Selection method: random draw, no repeat until full library cycled (confirmed as the v0.1 operating rule — see referenced document)
- Tone, length, and content parameters: defined in the Approved Response Library document
- **Document reference:** `approved_response_library_v01.md` — ✅ created (v0.1, placeholder content). Tone/voice and final content remain open — see that document's Open Questions section.

### 6.2 Approved Motivational Library
Motivational messages fire on a variable schedule independent of the GM response logic above.

- Delivery schedule and trigger logic: remains a separate algorithm component, not yet designed — out of scope for this document (Section 8)
- Content parameters: defined in the Approved Motivational Library document
- **Document reference:** `approved_motivational_library_v01.md` — ✅ created (v0.1, placeholder content + content-model framework). Delivery schedule, category weighting, and the fixed-vs-dynamic decision remain open — see that document's Open Questions section.

---

## 7. Internal State Model

The algorithm must track and persist the following variables per client:

| Variable | Type | Description | Client-Visible |
|---|---|---|---|
| `client_id` | String | Unique client identifier | No |
| `gm_received_today` | Boolean | At least one message today classified `is_valid_gm: true` | No |
| `compliance_status` | Enum: `Compliant` \| `Miss` \| `Pending Review` | Current day's resolved status per Section 4 (v0.3) | No |
| `streak_count` | Integer | Consecutive compliant days. Holds during Pending Review (4.5) | No |
| `current_response_level` | Integer (0–3) | Active response rate level | No |
| `window_position` | Integer (0–5) | Position within current 5-GM response window | No |
| `responses_given` | Integer | Responses sent within current window | No |
| `gm_log` | Timestamp Array | Log of all `is_valid_gm: true` classifications, with `reasoning` (v0.3, revised v0.4 — `matched_criteria` removed) | No |
| `miss_log` | Date Array | Full log of all days resolved as Miss | No |
| `pending_review_log` | Array of {date, message, failure_reason, timestamp} | Days currently awaiting resolution per 4.6 (v0.3) | No |
| `classification_log` | Array of {message, is_valid_gm, reasoning, timestamp} | **Recommended** — full classification audit trail, all messages, for monitoring and dispute resolution (v0.3, revised v0.4) | No |

---

## 8. Out of Scope — This Version

The following are confirmed system components intentionally excluded from this document:

- Phase transition triggers and level activation logic
- Cut threshold and client removal logic
- Miss notification or miss response behavior
- Non-GM message handling
- Motivational message delivery schedule and trigger logic
- GM channel definition and technical delivery infrastructure
- Onboarding and pre-enrollment agreement logic
- Training instruction logic
- Nutrition instruction logic
- Pending Review resolution process (human review interface, resolution criteria, any retroactive streak adjustment)

**Note (v0.5):** "GM channel definition and technical delivery infrastructure" above refers to the **production** channel (Open Decision #6, Session Starter Section 4), which remains out of scope and unresolved. A **development/testing** channel (Telegram) has been selected — see Section 10.2 — but this is a separate, narrower decision and does not resolve the item above.

---

## 9. Open Variables — Remaining Items

| Variable | Status | Note |
|---|---|---|
| Level activation triggers | 🟡 Out of scope (by design) | Pending phase transition decisions |
| Miss response behavior | 🟡 Out of scope (by design) | Blocked by cut threshold decision |
| Non-GM message handling | 🟡 Deferred (by design) | Not addressed in this version |
| Approved Response Library — tone/voice | 🟡 Content finalization pending | See `approved_response_library_v01.md` |
| Approved Motivational Library — content model | 🟡 Content finalization pending | See `approved_motivational_library_v01.md` |
| "Mornin'" / colloquial-Morning classification | ✅ Resolved (v0.4) | No longer requires pre-resolution — left to classifier judgment per Section 3.2; retained as an illustrative example in 3.3 |
| Non-English / multi-language detection | 🟡 Side-effect flagged (v0.4) | v0.4 guidance no longer explicitly scopes to English. A judgment-based classifier may recognize non-English greetings as a byproduct — not an explicit decision, flagged for awareness |
| **Pending Review resolution process** | 🔴 Required — new component | Unchanged from v0.3. Addresses LLM-call infrastructure failures — a separate concern from content judgment. See 4.6, 8. |
| LLM implementation specifics (model, prompt, config) | ✅ **Resolved (v0.5)** | Claude Haiku 4.5, forced tool use against Section 3.4 schema, Section 3.2(+3.3) as system prompt, extended thinking off — see Section 10.1 |
| GM channel — development/testing | ✅ **Resolved (v0.5)** | Telegram — see Section 10.2 |
| GM channel — production (Open Decision #6) | 🔴 Still open | Unchanged — Session Starter Section 4. The development-channel resolution above does not resolve this; a channel-adapter layer is assumed between core logic and whichever channel(s) are used (Section 10.2) |

---

## 10. Implementation Configuration — LLM & Development Channel

This section documents concrete implementation choices for building and testing the algorithm specified in Sections 3–7. These are configuration decisions layered on top of the model-agnostic logic above — Section 3.2's classification guidance remains authoritative regardless of implementation (v0.4, Section 9).

### 10.1 LLM — Claude Haiku 4.5

**Model:** `claude-haiku-4-5`, via the Claude API.

**Rationale:** The Section 3 classification task — a short message in, a judgment against Section 3.2's guidance, a structured result per Section 3.4 — is a high-throughput, low-complexity classification task performed once per client per message. Claude Haiku 4.5 is Anthropic's current lightweight tier, designed for exactly this profile, at substantially lower cost than the mid/flagship tiers with no meaningful quality loss for tasks of this shape. A larger model would not improve judgment on the borderline cases that v0.4 deliberately leaves to classifier discretion (Section 3.3) — it would only add cost and latency.

**Schema enforcement (Section 3.4):** Use a forced tool call — define a tool whose input schema matches `{is_valid_gm: boolean, reasoning: string}`, and set `tool_choice` to force that tool. The model's response *is* the structured output, which substantially narrows the "malformed output" branch of Section 3.6. The realistic remaining Pending Review (4.6) triggers are API-level: no response, error, or timeout — not schema drift.

**System prompt:** Section 3.2's guidance, included close to verbatim. Section 3.3's illustrative examples may be included as few-shot grounding for borderline cases.

**Extended thinking:** Off. Haiku 4.5 supports extended thinking, but this task is a single-step judgment call and does not benefit from it — leaving it enabled would add latency and cost with no quality gain here.

**Cost (informational, not a spec requirement):** At current published rates ($1 / $5 per million input / output tokens), each classification call — roughly 500–1000 input tokens including guidance and tool schema, ~50–100 output tokens — costs on the order of $0.001–0.0015 uncached, less with prompt caching on the static guidance/schema portion. This is a minor fraction of typical per-message channel costs (e.g., SMS).

**Migration note:** A future capability (e.g., full coaching chat) requiring a more capable model is a separate LLM call within the same provider account — not a change to this configuration. If Haiku 4.5's handling of borderline cases (Section 3.3) proves inconsistent in practice, swapping this specific call to a larger model in the same family is a configuration change, not an architecture change.

### 10.2 Development & Testing Channel — Telegram

**Channel:** Telegram Bot API, for development and testing only.

**Rationale:** Free, with no business verification required; supports an effectively unlimited number of test "clients" (any Telegram account can message the bot, unlike SMS trial accounts which require per-number verification); and provides a genuine two-way chat interface, useful for testing both the GM ritual and, later, richer conversational interactions.

**Scope of this decision:** This resolves a development-environment channel only. It does **not** resolve Open Decision #6 (production GM channel — Session Starter, Section 4), which remains open (see Section 9). Telegram's webhook payload format and send API differ from candidate production channels (e.g., SMS via Twilio). A channel-adapter layer is assumed to sit between the core logic in Sections 3–7 (which operates on message text and client identifiers, independent of channel) and whichever channel(s) are used — so that the production channel decision, whenever made, requires changes only to that adapter, not to this algorithm's logic.

**Out of scope (unchanged):** Production channel selection, technical delivery infrastructure at scale, and any channel-specific compliance requirements (e.g., SMS 10DLC registration) remain outside this document — see Section 8.

---

*Document Version: 0.5 | Type: Algorithm Specification | Scope: GM Ritual Only | Status: Implementation Configuration Added — Production Channel Still Open*
*Fitness Coaching Operating System | Build Log: GM Ritual Algorithm*
