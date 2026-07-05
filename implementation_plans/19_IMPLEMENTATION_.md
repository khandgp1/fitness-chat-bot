# 19 — Response Suggestion: System Prompt

> **Series: Response Suggestion Feature (Plans 19–22)**
>
> | Plan                                                                                                       | Component         | Depends On |
> | ---------------------------------------------------------------------------------------------------------- | ----------------- | ---------- |
> | **19**                                                                                                     | **System Prompt** | —          |
> | [20](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/20_IMPLEMENTATION_.md) | Suggestion Engine | 19         |
> | [21](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/21_IMPLEMENTATION_.md) | API Endpoints     | 20         |
> | [22](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/implementation_plans/22_IMPLEMENTATION_.md) | Dashboard UI      | 21         |

---

## Goal

Create the coaching persona system prompt file that the suggestion engine will load at runtime. Extracted to `data/` so tone and style can be iterated without code changes.

---

## Design Decisions (from interview)

| Decision            | Resolution                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Coaching tone       | Direct, minimal, 1-2 sentences, no emojis                                                    |
| Follow-up questions | Can ask short follow-up questions when relevant                                              |
| Prompt location     | `data/suggestion-prompt.md` (outside `src/`, editable without rebuild)                       |
| Prompt structure    | Role + tone rules + length constraint + style rules + context instructions + example outputs |

---

## Proposed Changes

#### [NEW] [suggestion-prompt.md](file:///Users/khandpv1/Desktop/.AntiGrav/fitness-chat-bot/data/suggestion-prompt.md)

A markdown file containing the system prompt for response suggestion generation.

**Contents:**

1. **Role definition** — "You are a fitness coach texting your client."
2. **Tone rules** — Direct and minimal. Short, punchy, no fluff.
3. **Length constraint** — 1-2 sentences max. Texting, not emailing.
4. **Style rules** — No emojis. Can ask short follow-up questions when relevant.
5. **Context instructions** — You'll receive the client's recent messages and their current state. Respond to the substance of what they said.
6. **Example outputs** — 3-5 calibration examples showing ideal responses to different message types (GM follow-up, training update, question, venting).

---

## Verification

- File exists at `data/suggestion-prompt.md`
- Content includes all 6 sections above
- Prompt is self-contained and readable as a standalone system prompt

---

## Checklist

- [ ] Create `data/suggestion-prompt.md` with coaching persona system prompt
- [ ] Include role definition
- [ ] Include tone and style rules
- [ ] Include length constraint
- [ ] Include context instructions
- [ ] Include calibration examples
