# Reference: Domain Knowledge

## The Coaching Model

### Philosophy: Progressive Accountability
The coaching system is built on a core insight: **clients fail from information overload, not information scarcity**. The approach:

1. Start with one habit (daily GM check-in)
2. Build consistency through accountability
3. Each week, layer on one new focus area
4. Only advance when the current habit is solid

This means the system should never dump a full training program + meal plan + supplement stack on a new client. It should focus them on *one thing this week*.

### The GM Ritual (Current Foundation)
The daily "GM" (good morning) check-in is the foundational behavior anchor:
- Client sends a message in the spirit of "GM" or "good morning" each day
- The system classifies whether the message counts as a valid check-in
- Compliance is tracked (streaks, misses)
- The coach responds to build the relationship and reinforce the habit

**Why this works:** The act of checking in daily creates a psychological commitment loop. The streak creates loss aversion. The coach's response creates social accountability.

---

## Compliance Logic (Extracted Principles)

These are the core compliance concepts from the working prototype. The redesign should preserve these principles even if the implementation changes.

### State Machine
Each client-day exists in one of four states:

```
Unknown → Compliant (valid GM received)
Unknown → Miss (day ends with no valid GM and no pending classification)
Unknown → Pending Review (classification failed, no valid GM confirmed)
Pending Review → Compliant (valid GM received later that day — natural resolution)
Pending Review stays Pending Review (day ends without resolution — holds indefinitely)
```

### Streak Logic
- Increments by 1 on each Compliant day
- Resets to 0 on each Miss
- **Holds** (neither increments nor resets) during Pending Review
- Never surfaced to the client (internal metric only)

### Classification
- Uses LLM (Claude Haiku 4.5) with forced tool-calling to classify messages
- Returns `{ is_valid_gm: boolean, reasoning: string }`
- Classification guidance is principle-based, not rule-based:
  - "GM" and "good morning" (and typo variants) are valid
  - Bare "morning" alone generally falls short
  - The classifier's judgment on borderline cases is authoritative
- Operator can override classifications via "reasoning memory" — approved examples injected into the classifier's system prompt as few-shot guidance

---

## Coaching Persona

The operator has defined a specific coaching voice:
- **Direct and minimal** — no fluff, no excessive pleasantries
- **Short, punchy, supportively objective** — fits text message format
- **No emojis** — ever
- **1-2 sentences max** per response
- Can ask short follow-up questions to guide the client forward

### Calibration Examples (from production prompt)

| Client Message | Coach Response |
|---|---|
| "Forgot my check-in this morning, sorry. Was rushing out." | "No worries. What did you end up having for breakfast?" |
| "Just finished the leg workout. Feeling super exhausted but got all reps done." | "Awesome work pushing through. Make sure to get a high-protein meal in soon." |
| "Can I swap the white rice for sweet potatoes in my meal plan?" | "Yes, that is a direct 1-to-1 swap for your carb source. Just keep the portion size the same." |
| "Stressed today and skipped the gym, then ate cookies." | "One off-track day won't ruin your progress. Let's focus on hitting tomorrow's workout and meal plan." |

---

## Structured Client Narrative (Memory)

Raw conversation history is poor context for LLMs over time. The system should maintain a **structured client narrative** — a living document updated after interactions that captures:
- Current focus and obstacles
- What the client responds well to (and what they don't)
- Key life context (e.g., works night shifts, has kids)
- Recent coaching notes and agreements

This narrative should be updatable by the agents based on interactions, but **the operator must have the ability to manually revise this data**. Additionally, there should be an assessment prompt/workflow where the operator can review a client's progress and the agent's performance, and output updates to both the coaching process and this client narrative.

---

## Future Coaching Domains (Planned)

These are not yet built but represent the direction the system will grow:

1. **Nutrition guidance** — macro targets, meal plan adjustments, food substitutions
2. **Training guidance** — exercise programming, progression tracking, form cues
3. **Body metrics tracking** — weight trends, measurements, body composition
4. **Goal setting & milestones** — target weight/physique, timeline, weekly focus areas
5. **Intake/onboarding** — initial questionnaire, experience level assessment, injury screening

Each domain will be added incrementally. The architecture should support plugging in new coaching domains without restructuring existing ones.

---

## Client Lifecycle (Anticipated)

```
Prospect → Intake/Onboarding → Active Client → [ongoing coaching] → Graduation/Drop
```

Current state: only "Active Client" with basic accountability. The redesign should plan for the full lifecycle but only implement what's needed now.
