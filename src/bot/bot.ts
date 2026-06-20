import express, { Request, Response } from 'express';
import { clientExists, createClient, loadClient, saveClient } from '../state/store.js';
import { classifyMessage } from '../classifier/classify.js';
import { handleGmResult } from '../compliance/compliance.js';

const messageQueues = new Map<string, string[]>();
const batchStartTimestamps = new Map<string, string>();

async function processBatch(userId: string, anchoredTimestamp?: string): Promise<void> {
  const queue = messageQueues.get(userId);
  messageQueues.delete(userId);

  if (!queue || queue.length === 0) {
    return;
  }

  try {
    console.log(`[Batch] Processing batch of ${queue.length} messages for "${userId}" (anchor=${anchoredTimestamp ?? 'now'})`);

    // Ensure client exists
    if (!clientExists(userId)) {
      console.log(`[Batch] Client "${userId}" does not exist. Creating new client...`);
      createClient(userId, 'America/New_York');
    }

    // Load client state using anchored timestamp so day-transition is evaluated
    // against the moment the first message arrived, not when the cron fired.
    const state = loadClient(userId, anchoredTimestamp);

    // Concatenate all messages with newline
    const concatenatedMessage = queue.join('\n');

    // Classify concatenated message
    const result = await classifyMessage(concatenatedMessage);

    // Handle compliance and streak update, passing the same anchor so the
    // effective date stays consistent throughout the pipeline.
    const updatedState = handleGmResult(state, result, concatenatedMessage, anchoredTimestamp);

    // Save state
    saveClient(updatedState);

    console.log(
      `[Batch pipeline] userId=${userId} | messages=${queue.length} | isValidGM=${result?.is_valid_gm ?? 'error'} | compliance=${updatedState.compliance_status} | streak=${updatedState.streak_count}`
    );
  } catch (err) {
    console.error(`[Batch] Error processing batch for "${userId}":`, err);
  }
}

/**
 * Flushes any pending queued messages for a user immediately.
 * Called by the hourly cron scheduler. Uses the anchored timestamp recorded
 * when the first message arrived so the correct calendar day is used.
 */
export async function flushPendingBatch(userId: string): Promise<void> {
  const anchoredTimestamp = batchStartTimestamps.get(userId);
  batchStartTimestamps.delete(userId);
  await processBatch(userId, anchoredTimestamp);
}

export function startBotServer(): void {
  const app = PatternApp();
  app.use(express.json());

  const port = process.env.BOT_PORT || '4000';

  app.post('/webhook', (req: Request, res: Response) => {
    const { userId, message } = req.body;

    // Validate payload structure
    if (!userId || typeof message !== 'string') {
      console.error('[webhook] Invalid request body format:', req.body);
      res.status(400).send('Invalid request body. "userId" and "message" are required.');
      return;
    }

    // 1. Respond with HTTP 200 OK after successful validation
    res.sendStatus(200);

    // Enqueue message in-memory. Anchor the timestamp on the first message of
    // each new batch so the effective calendar date is always correct.
    if (!messageQueues.has(userId)) {
      messageQueues.set(userId, []);
      batchStartTimestamps.set(userId, new Date().toISOString());
      console.log(`[webhook] New batch started for client "${userId}" — processing deferred to next hourly cron tick`);
    }
    messageQueues.get(userId)!.push(message);
  });

  app.listen(Number(port), () => {
    console.log(`Bot webhook server listening on port ${port}`);
  });
}

function PatternApp() {
  return express();
}

