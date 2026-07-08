---
name: assess
description: Deep review of a coaching client AND the AI agents' performance on them (design-plane workflow). Use for a periodic check-in — client trajectory, what's working, how the coach agent's drafts are landing.
---

# /assess <client name or id>

Read `Claude/STUDIO.md` first and follow its rules throughout. Work from `v2/`.

1. **Pull everything:** `npm run studio -- clients`, then `context <id>`, then
   `calibration --client <id>`. Ad-hoc read-only SQL is fine for deeper questions
   (`sqlite3 "file:data/v2.sqlite?mode=ro" …`).
2. **Produce the assessment** — three sections, grounded in the data you pulled, each
   with the evidence stated:
   - **Client trajectory:** compliance trend, streak pattern, engagement shifts,
     progress against the narrative's Current Focus.
   - **Agent performance:** how drafts are landing — sent as-is vs edited vs rejected,
     what the operator's edits consistently change (length? tone? content?), router
     dismissals, anything the classifier got wrong.
   - **Process observations:** anything about the system or workflows worth changing.
3. **Discuss with the operator.** Their read on the client outranks the data.
4. **Act on the outcomes, with approval:**
   - Narrative updates → follow the `/narrative-update` steps 2, 5, 6 (snapshot, edit, resolve).
   - Prompt/calibration changes → follow the `/tune-prompts` conventions (evidence,
     approval, commit to the main repo).
5. **Report:** the assessment plus what was changed as a result.
