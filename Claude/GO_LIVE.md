# Go-Live Runbook (Stage 8, operational half)

Operator-paced. Each phase has a "done when." The prototype keeps running in
production until Phase 3 — nothing here touches it before that.

## Phase 1 — Pre-flight (one evening)

- [x] `v2/.env` complete: `TELEGRAM_TOKEN` (still the DEV bot for now), `ANTHROPIC_API_KEY`, `ADMIN_TOKEN`, `DEBOUNCE_MINUTES=3` (production value — remove any test override)
- [x] `cd v2 && npm test` — all green
- [x] `npm run ui:build` then `npm start` — UI reachable, health banner absent
- [x] A `data/backups/<today>/` directory exists after the first tick (~15 min)
- [x] `npm run clock -- status` shows offset +0h and **no snapshot** (reset any leftover simulation first)

**Done when:** clean boot, green health, today's backup on disk.

## Phase 2 — Shakedown week (7 days, ~5 min/day)

You are the fake client (dev panel, or a second Telegram account against the dev bot).

- Daily: send a GM (sometimes late, sometimes with a question, one day skip
  entirely) → work the triage queue exactly as you would for a real client:
  draft, edit, send, dismiss.
- At least once each: correct a compliance day · run `/narrative-update` ·
  run `/assess` · kill the app mid-debounce and restart (watch the sweep/re-arm
  boot line) · check the health banner catches a fake problem (e.g. stop the
  app for an hour, restart, confirm the day reconciles).
- Anything that surprises you → back to Claude Code, it's a Stage 8 fix.

**Done when:** 7 days used daily with no surprises you haven't had fixed.

## Phase 3 — Cutover (an evening, after the client's check-in)

1. Stop the prototype process. **Do not** touch its files.
2. In `v2/.env`: swap `TELEGRAM_TOKEN` to the **production** bot token.
3. `npm start` (v2 now owns the production bot).
4. Send the client a heads-up from your own phone if you like — nothing about
   the system requires it.
5. His next message auto-registers him → **verify him in the UI** (triage: "new
   unverified contact").
6. Same day: `/narrative-update <him>` in a Claude Code session — author his
   initial narrative. Keep the prototype's `data/*.json` open as reference
   (D22: archive is reference, never imported). Note his long GM history in
   the narrative ("consistent GM habit since <month>") — his streak number
   starts at 0 by design; the *relationship* context lives in the narrative.
7. Set his timezone in the UI if it isn't America/New_York.

**Done when:** his first GM on v2 classifies (watch the log / llm_calls) and
his streak shows 1.

## Phase 4 — Stability week + rollback path

- The prototype stays runnable and untouched for 7 days. **Rollback** = stop
  v2, swap the token back in the prototype's env, start it. (Days spent on v2
  won't exist in the prototype's JSON — acceptable for an emergency week.)
- Watch: health banner daily, his GMs classifying, drafts sounding like you.

**Done when:** 7 stable days.

## Phase 5 — Retirement

1. Prototype: move `src/` → `legacy/src/` (with its `package.json` → `legacy/`),
   keep root `data/` frozen as the reference archive. (Completes P4-1.)
2. Optional cleanup: root `docs/` and `implementation_plans/` → `legacy/`.
3. Delete the dev bot token from anywhere it lingers if unused.

**This closes Stage 8, Phase 5, and the redesign.**
