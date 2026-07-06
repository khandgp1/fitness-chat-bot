# Reference: Project Overview

## What This Project Is

A Telegram-based AI fitness coaching bot that helps men build physique through daily accountability and progressive coaching guidance. The operator (solo coach) uses AI to scale 1-on-1 coaching capacity.

## Current State — What Exists

### Production Status
- **Live with 1 real client** on Telegram
- Operator reviews every AI-suggested response before sending
- Running on local machine (not cloud-deployed)
- Free to operate (no paid infrastructure beyond Anthropic API)

### What's Working
| Feature | Status | Notes |
|---|---|---|
| Telegram message ingestion | ✅ Working | Grammy bot receives client messages via long polling |
| GM classification | ✅ Working | Claude Haiku 4.5 with forced tool-calling classifies check-ins |
| Compliance tracking | ✅ Working | Streaks, misses, pending review — full state machine |
| Suggestion engine | ✅ Working | LLM generates draft responses for operator review |
| Human-in-the-loop send | ✅ Working | Operator approves via dashboard, bot sends via Telegram |
| Admin dashboard | ✅ Working | Express-served HTML page with polling-based updates |
| Dev tools | ✅ Working | Time simulation (advance day/hour), client reset, compliance checks |
| Reasoning memory | ✅ Working | Operator can override classifier judgments and inject them as few-shot examples |

### What's Not Built Yet (From Original Spec)
- Miss response behavior (what to send when a client misses)
- Cut threshold (when to drop a client)
- Non-GM message handling (questions, updates, coaching conversations)
- Motivational message scheduling
- Onboarding flow / intake
- Training and nutrition instruction
- Multi-client management (dashboard is single-client focused)

### Known Limitations
1. **Flat JSON files** — no querying, no concurrent writes, growing file sizes
2. **Single LLM task** — classifier only, no agent framework or tool-calling
3. **Suggestion engine is simple** — reads recent messages, generates a text response. No structured reasoning, no access to client history, no domain-specific knowledge
4. **Dashboard doesn't scale** — dropdown client selector, but all UI is one-client-at-a-time
5. **No message queuing** — in-memory batch queue is lost on process restart
6. **All state is in-memory or JSON** — message logs, suggestions, timestamps are lost on restart
7. **No authentication** — dashboard is open to anyone who can reach the port

## Operator Profile

- Solo coach, technical (comfortable with TypeScript, APIs, deployment)
- Iterating live with real clients — changes must be safe
- Coaching philosophy: accountability-first, progressive disclosure (don't overwhelm clients)
- Primary constraint: keep costs near zero
- Wants AI to handle routine interactions so he can focus on high-value coaching moments

## 33 Implementation Plans

The project has gone through 33 iterative implementation plans (numbered 00-33), reflecting a rapid prototyping approach. Key themes across these plans:
- Incremental feature addition (not big-bang releases)
- Dev tooling for time simulation (critical for testing compliance logic)
- Dashboard evolution (from raw JSON display to styled UI)
- Reasoning memory system (operator feedback loop for classifier)
- Message batching (handle multiple messages before classification)
- Suggestion engine (LLM-powered response drafts)

This history shows the operator's iteration style: small, testable changes with frequent course corrections.
