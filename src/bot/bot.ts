import express, { Request, Response } from 'express';
import { clientExists, createClient, loadClient, saveClient } from '../state/store.js';
import { classifyMessage } from '../classifier/classify.js';
import { handleGmResult } from '../compliance/compliance.js';
import { shouldRespond } from '../response/responseEngine.js';
import { getRandomResponse } from '../response/contentLibrary.js';

export function startBotServer(): void {
  const app = express();
  app.use(express.json());

  const port = process.env.BOT_PORT || '4000';
  const sandboxReplyUrl = process.env.SANDBOX_REPLY_URL || 'http://localhost:3001/incoming-reply';

  app.post('/webhook', (req: Request, res: Response) => {
    const { userId, message, timestamp } = req.body;

    // Validate payload structure
    if (!userId || typeof message !== 'string' || typeof timestamp !== 'string') {
      console.error('[webhook] Invalid request body format:', req.body);
      res.status(400).send('Invalid request body. "userId", "message", and "timestamp" are required.');
      return;
    }

    // Validate ISO 8601 format and parsability
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
    if (!iso8601Regex.test(timestamp) || isNaN(Date.parse(timestamp))) {
      console.error('[webhook] Invalid ISO 8601 timestamp:', timestamp);
      res.status(400).send('Invalid timestamp. Must be a valid ISO 8601 string.');
      return;
    }

    // 1. Respond with HTTP 200 OK after successful validation
    res.sendStatus(200);

    // Process asynchronously to simulate real webhook behavior
    (async () => {
      try {
        console.log(`[webhook] Received message from "${userId}": "${message}" with timestamp "${timestamp}"`);

        // 2. Ensure client exists
        if (!clientExists(userId)) {
          console.log(`[webhook] Client "${userId}" does not exist. Creating new client...`);
          createClient(userId, 'America/New_York', timestamp);
        }

        // 3. Load client state (automatically catches up days)
        const state = loadClient(userId, timestamp);
        const wasGmReceivedToday = state.gm_received_today;

        // 4. Classify message
        const result = await classifyMessage(message);

        // 5. Handle compliance and streak update
        const updatedState = handleGmResult(state, result, message, timestamp);

        // 6. Check if we should respond
        // Only respond if:
        // - We generated a valid classification result that is a valid GM
        // - It wasn't already received today (not a duplicate)
        // - The response engine says we should respond
        const isNewValidGm = result !== null && result.is_valid_gm && !wasGmReceivedToday;

        let responded = false;
        if (isNewValidGm) {
          const responseDecision = shouldRespond(updatedState);
          if (responseDecision.respond) {
            const replyText = getRandomResponse();
            responded = true;

            console.log(`[webhook] Sending reply to sandbox: "${replyText}"`);

            try {
              const replyResponse = await fetch(sandboxReplyUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  userId,
                  message: replyText,
                }),
              });

              if (!replyResponse.ok) {
                console.error(`[webhook] Failed to send reply to sandbox. Status: ${replyResponse.status}`);
              }
            } catch (fetchErr) {
              console.error(`[webhook] Error posting reply to sandbox at ${sandboxReplyUrl}:`, fetchErr);
            }
          }
        }

        // 7. Save state
        saveClient(updatedState);

        console.log(
          `[pipeline] userId=${userId} | isValidGM=${result?.is_valid_gm ?? 'error'} | responded=${responded} | compliance=${updatedState.compliance_status} | streak=${updatedState.streak_count}`,
        );
      } catch (err) {
        console.error('[webhook] Async pipeline error:', err);
      }
    })();
  });

  app.listen(Number(port), () => {
    console.log(`Bot webhook server listening on port ${port}`);
  });
}
