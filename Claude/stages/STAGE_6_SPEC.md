# Stage 6 — Admin UI

**Status:** Spec presented for operator review
**Roadmap:** `PHASE_4_ROADMAP.md` §3, Stage 6
**Goal:** The operator's daily cockpit (Phase 1 §2.7): auth, the triage-first home over all six item types, client detail with compliance calendar + narrative quick-edit, the approve/edit/send flow, admin actions, and a dev panel. Ends with: a full simulated coaching day without touching a terminal.

---

## Design Notes

- **One process, two layers:** an Express API mounted in the existing app (`/api/*`) plus a Vite+React SPA served statically from its build output (D5). `npm start` serves both; `npm run ui:dev` runs Vite's dev server proxying `/api` for UI work.
- **Auth (D5, non-negotiable):** the server refuses to start without `ADMIN_TOKEN`. `POST /api/login {token}` → constant-time compare → httpOnly session cookie (random id, in-memory session set — a restart just means re-login). Every other `/api/*` route requires the session. Static assets are unauthenticated (they contain no data); every byte of data flows through the authed API.
- **Triage is a query, not a table (P3-8):** `GET /api/triage` assembles the six item types live — awaiting-response batches, pending drafts, miss follow-ups, pending reviews, narrative staleness (vs config thresholds), unverified contacts — each with its client name and the actions it affords. The UI is a renderer of this list; it holds no queue logic.
- **Every UI action is an existing domain operation** — the API layer is thin glue over DraftService, ComplianceEngine, ClientRepo, NarrativeStore, MessageRepo. No new business logic lives in routes; anything that feels like logic goes into the services (that's where corrections' `correctDay` and reset/delete already are).
- **Draft trigger is a blocking POST** (the coach takes seconds; the UI shows a spinner). Stale sends surface the `StaleDraftError` as a 409 with a human message; the UI offers "re-trigger".
- **Narrative quick-edit** goes through `NarrativeStore.quickEdit` (file write + git commit + audit) — the UI is a textarea over the raw markdown, deliberately: substantive narrative work belongs in the design plane (D17); this is the typo-fix path.
- **Dev panel is devMode-gated** at both API and UI: clock status/advance/reset (snapshot semantics included), plus a "simulate inbound" box that pushes a message through the real ingest path via a dev-only fake-channel identity — so a full coaching day can be simulated without Telegram.
- **Polling, not sockets:** the SPA refetches the active view every 5s (Phase 1 accepted polling; SSE only if it ever matters).
- **Testing split per the roadmap:** API-level tests for every route (auth required, actions audited, atomicity) using `fetch` against the server on an ephemeral port with the fake adapter + fake LLM; the UI itself is exercised manually at your Verify.
- **New deps:** `express` (+types) runtime; `react`, `react-dom`, `vite`, `@vitejs/plugin-react` (+types) dev/UI.

## File List

```
v2/src/server/server.ts          # express wiring: auth, sessions, static, mount api
v2/src/server/api.ts             # routes (thin glue over services)
v2/src/server/triage.ts          # the six-type triage assembly
v2/src/app.ts                    # UPDATED: start()/stop() run the server; deps expose it
v2/admin-ui/index.html           # Vite root
v2/admin-ui/src/main.tsx         # router-less SPA: view state in App
v2/admin-ui/src/api.ts           # typed fetch client
v2/admin-ui/src/App.tsx          # login gate + nav (Triage · Clients · Dev)
v2/admin-ui/src/views/Triage.tsx       # the cockpit home
v2/admin-ui/src/views/Clients.tsx      # roster + verify/block/reset/delete
v2/admin-ui/src/views/ClientDetail.tsx # conversation, compliance calendar, narrative, drafts, audit
v2/admin-ui/src/views/DevPanel.tsx     # clock, snapshot, simulate-inbound
v2/vite.config.ts
v2/test/api.test.ts
```

## API Surface (all authed unless noted)

| Method/Path | Backs onto |
|---|---|
| POST `/api/login` (unauthed) | session issue |
| GET `/api/triage` | triage assembly |
| GET `/api/clients` · GET `/api/clients/:id` | roster; detail bundle (client, streak, calendar, narrative, drafts, staleness) |
| GET `/api/clients/:id/messages?before=` | conversation, paged |
| POST `/api/clients/:id/verify` · `/block` · `/reset` · `/delete` | ClientRepo (delete/reset behind a UI confirmation) |
| PUT `/api/clients/:id/timezone` | ClientRepo.update |
| PUT `/api/clients/:id/narrative` | NarrativeStore.quickEdit |
| POST `/api/clients/:id/drafts` | DraftService.triggerDraft (blocking) |
| POST `/api/drafts/:id/send` `{text?}` | DraftService.send (stale → 409) |
| POST `/api/drafts/:id/reject` | DraftService.reject |
| POST `/api/batches/:id/dismiss` | MessageRepo.dismissBatch |
| POST `/api/compliance/:clientId/:date/correct` `{status}` | ComplianceEngine.correctDay |
| POST `/api/followups/:clientId/:date` `{state}` | ComplianceRepo.setFollowupState |
| GET `/api/audit?clientId=&limit=` · GET `/api/llm-calls?...` | AuditRepo |
| GET `/api/dev/clock` · POST `/api/dev/clock/advance` `/reset` (devMode) | clock + snapshot |
| POST `/api/dev/inbound` `{clientExternalId, text}` (devMode) | ingest via dev channel |

## Tasks

- [x] **1. Server + auth** — express mounted in `buildApp` (server construction lazy in `start()` so CLIs keep working without a token); token login, session middleware, sha256+timingSafeEqual compare; static serving of `admin-ui/dist`.
  *AC: all five auth tests green + static-SPA-served test.* ✅
- [x] **2. Triage assembly + API routes** — the six-type query; thin glue; StaleDraft/ActiveDraft → 409.
  *AC: all cases green — six types seed/clear, HTTP draft round-trip (incl. 409 on double-trigger and stale send), correction recompute, reset audited, dev routes 404 in prod mode.* ✅ 10 tests
- [x] **3. UI scaffold** — Vite config, login gate, nav, typed API client, 5s `usePoll` hook; `admin-ui/src` included in `npm run typecheck`.
  *AC: `ui:build` → 65KB gzipped bundle, served by `npm start`.* ✅
- [x] **4. Triage view** — grouped cockpit with inline actions, editable pending-draft textarea, drafting spinner. ✅ (manual at Verify)
- [x] **5. Clients + ClientDetail views** — roster with confirm-gated reset/delete; detail: 28-day click-to-correct calendar, draft panel, narrative quick-edit, conversation, audit tail, staleness badge. ✅ (manual at Verify)
- [x] **6. Dev panel** — clock (advance auto-snapshots via D20; full rewind deliberately CLI-only — restoring the DB file under an open connection is unsafe), simulate-inbound through the real ingest path (existing client via dev identity, or a fresh stranger). ✅ (manual at Verify)

**Stage complete:** 120 tests green (12 new), typecheck clean (UI included), SPA built. Awaiting operator Verify checkpoint (needs `ADMIN_TOKEN` added to `.env`).

## Verify (operator checkpoint)

**Restart `npm start` first.** Then in a browser at `http://localhost:3000` — the whole checkpoint is: **run a full simulated coaching day without touching a terminal.**

1. Log in with your `ADMIN_TOKEN`.
2. Dev panel: simulate an inbound "GM — also, should I deload this week?" → watch it appear in triage as awaiting-response after the debounce (and the streak move on the client).
3. Triage: trigger a draft → edit it inline → send. (With your real Telegram client you can do the same against a real message and see it arrive on your phone.)
4. Client detail: fix a day via the compliance calendar (correct a miss → watch the streak recompute), quick-edit the narrative (then check `git log` in the narratives dir — one commit).
5. Clients: verify/block a fresh simulated stranger; reset a throwaway client behind the confirmation.
6. Dev panel: advance a day, watch a miss follow-up appear in triage the next morning, dismiss it.
7. `npm test` green throughout.
