---
name: narrative-update
description: Update a coaching client's narrative from recent conversation history (design-plane workflow). Use when the operator wants to refresh what the bot knows about a client, or a staleness nudge appeared in the admin UI.
---

# /narrative-update <client name or id>

Read `Claude/STUDIO.md` first and follow its rules throughout. Work from `v2/`.

1. **Resolve the client:** `npm run studio -- clients` (match by name if the operator gave one).
2. **Guard:** `npm run studio -- snapshot <id>` (daily pre-image before any edit).
3. **Pull context:** `npm run studio -- context <id>` — read the current narrative,
   uncleared flags, compliance, and everything the client said since the watermark.
4. **Interview the operator, briefly.** Summarize what you see in the new material
   (2–4 bullet points: candidate durable facts, pattern changes, flag contents), then
   ask what they want captured, corrected, or ignored. This is a conversation, not a
   form — react to what they say.
5. **Edit `v2/data/narratives/<id>.md`** (create from the section convention if absent:
   Snapshot / Current Focus / Obstacles / What Works / Life Context / Log). Curate the
   top sections; append dated one-liners to Log; prune what's obsolete. Show the
   operator the result and adjust until they're satisfied.
6. **Resolve:** `npm run studio -- resolve <id>` — even when the outcome was "nothing
   durable this time" (that adjudicates the flags and clears the nudge).
7. **Report:** one short summary of what changed in the narrative.
