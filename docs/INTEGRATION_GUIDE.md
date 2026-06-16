# Integration Guide: Using Sandbox Chat as a Bot Test Harness

This guide explains how a separate **bot algorithm project** (e.g. a fitness coaching bot) can use `sandbox-chat` as a local test harness — mirroring the exact communication pattern of a real Telegram bot, but entirely locally and under your control.

---

## How It Works

The sandbox mirrors the real Telegram bot communication model exactly:

```
Telegram Model (Production):
  User → Telegram → POST to Bot's webhook URL → Bot processes → POST to Telegram sendMessage API → User sees reply

Sandbox Model (Local Testing):
  Human types in UI → Sandbox → POST to Bot's webhook → Bot processes → POST to Sandbox /incoming-reply → UI polls and displays reply
```

There is **no synchronous request-response**. Every POST is fire-and-forget. Each side acks with `200 OK` and the reply travels on a completely separate HTTP request — exactly like a real Telegram integration.

---

## Architecture Diagram

```text
+-------------------+
|   Browser UI      |  ← Human tester types here; polls for replies
| (React, port 5173)|
+-------------------+
         |                              ^
         | POST /message                | GET /incoming-reply (polls ~1s)
         v                              |
+--------------------------------------------------+
|              Sandbox Backend                     |  ← Express, port 3001
|  - Receives user messages from UI               |
|  - Forwards them to the Bot Server webhook      |
|  - Receives bot replies at POST /incoming-reply |
|  - Serves latest reply at GET /incoming-reply   |
+--------------------------------------------------+
         |                              ^
         | POST /webhook                | POST /incoming-reply
         | { userId, message, history } | { userId, message }
         v                              |
+-------------------+                  |
|   Your Bot Server |------------------+
|  (algo project)   |
+-------------------+
```

**Step by step:**
1. Human types a message → UI sends `POST /message` to sandbox
2. Sandbox stores the message, returns `200 OK` to UI immediately
3. Sandbox fires `POST /webhook` at the Bot Server (no reply expected)
4. Bot Server acks with `200 OK`, then processes the message asynchronously
5. Bot Server fires `POST /incoming-reply` at the Sandbox with the reply text
6. Sandbox stores the reply, returns `200 OK` to Bot Server
7. UI polls `GET /incoming-reply` every ~1 second
8. Sandbox returns the queued reply → UI displays it in the chat window

---

## What You Need to Build (Your Project)

Your bot algorithm project must:
1. Expose a **webhook endpoint** that the sandbox calls when the user sends a message
2. Call the **sandbox's reply endpoint** to deliver the bot's response

### 1. Expose: `POST /webhook`

The sandbox sends the user's message here.

**Request body (sent by the sandbox):**

```json
{
  "userId": "sandbox-user",
  "message": "Hello, I want to get fit",
  "history": [
    { "role": "user", "userId": "sandbox-user", "text": "Hello, I want to get fit", "timestamp": "2026-01-01T00:00:00.000Z" },
    { "role": "bot",  "userId": "sandbox-user", "text": "Great! Let's get started.", "timestamp": "2026-01-01T00:00:01.000Z" }
  ]
}
```

| Field | Type | Description |
|:---|:---|:---|
| `userId` | `string` | Identifier for the sandbox user (always `"sandbox-user"` in single-user mode) |
| `message` | `string` | The raw text the user just sent |
| `history` | `ConversationEntry[]` | Full conversation history **prior to** the current message, oldest first |

**Required response:**

```
HTTP 200 OK
(empty body or any JSON — sandbox ignores the response body)
```

Ack immediately. Do your processing after responding.

### 2. Call: `POST /incoming-reply` on the Sandbox

After your bot generates a reply, POST it back to the sandbox.

**Endpoint:** `http://localhost:3001/incoming-reply`

**Request body:**

```json
{
  "userId": "sandbox-user",
  "message": "Great choice! What are your current fitness goals?"
}
```

| Field | Type | Description |
|:---|:---|:---|
| `userId` | `string` | Must match the `userId` from the original webhook call |
| `message` | `string` | The bot's reply text — this is what the user sees in the UI |

**Expected response:**

```
HTTP 200 OK
```

---

## Sandbox Configuration

To enable Webhook Relay Mode, configure the sandbox backend using the environment variable:

```dotenv
# .env
PORT=3001
VITE_API_URL=http://localhost:3001
BOT_WEBHOOK_URL=http://localhost:4000/webhook
```

Set `BOT_WEBHOOK_URL` to the full URL of your bot's `/webhook` endpoint. If this variable is **not set**, the sandbox falls back to its built-in placeholder bot engine — so existing usage is unaffected.

