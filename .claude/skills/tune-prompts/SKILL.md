---
name: tune-prompts
description: Evidence-first tuning of the runtime agents' prompts (design-plane workflow). Use when coach drafts keep needing the same edits, the router mislabels, the GM classifier needs a new ruling, or the operator wants to adjust agent behavior.
---

# /tune-prompts [router | gm_classifier | coach]

Read `Claude/STUDIO.md` first and follow its rules throughout. Work from `v2/`.

1. **Evidence first:** `npm run studio -- calibration` (cross-client). Look for
   patterns, not incidents: edit rates by response type, what edits change, router
   dismissal clusters, confidence vs outcome. Ad-hoc read-only SQL for anything deeper.
2. **Diagnose before prescribing.** Tie each observed pattern to a specific prompt
   file: `coach_persona.md` / `coach_examples.md` / `coach_system.md` for draft
   quality; `router.md` for intent/needs_response; `gm_classifier_examples.md` for
   classification rulings (append operator-approved rulings in its documented format).
3. **Propose specific edits with the evidence attached** ("14 of 17 coaching_answer
   drafts were shortened → tighten the persona's length rule"). Small, one lever at a
   time — these files are live on the next message (hot-read).
4. **Apply only what the operator approves**, then commit the prompt files to the main
   repo with the evidence in the commit message (llm_calls records prompt hashes, so
   old calls stay traceable to old versions).
5. **`autonomy.yaml` is touched only on an explicit operator decision** to move a
   response type up the ladder — never as routine tuning.
6. **Report:** what changed, why, and what signal would show it worked.
