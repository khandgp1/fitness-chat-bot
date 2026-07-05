import express, { Request, Response } from 'express';
import { clientExists, createClient, loadClient, saveClient } from '../state/store.js';
import { classifyMessage } from '../classifier/classify.js';
import { handleGmResult } from '../compliance/compliance.js';
import { devNow, advance1Hour, resetClock, getOffsetMs } from '../dev/clock.js';
import { logMessage, getMessages } from '../dev/messageLog.js';
import { getDashboardHtml } from '../dev/dashboardHtml.js';
import { resetClient } from '../dev/resetClient.js';
import { getLocalHour, select5pmReply } from '../response/fivePmReply.js';
import {
  generateSuggestion,
  markSuggestionSent,
  getLatestSuggestion,
} from '../response/suggestionEngine.js';
import { sendTelegramReply } from './telegramBot.js';
import { getRoster } from '../state/clientRoster.js';

const messageQueues = new Map<string, string[]>();

function getDevClientId(): string {
  return getRoster()[0] ?? 'sandbox-user';
}

function resolveClientId(req: Request): string {
  const queryId = req.query.clientId;
  if (typeof queryId === 'string' && queryId.trim()) {
    return queryId.trim();
  }
  return getDevClientId();
}
const batchStartTimestamps = new Map<string, string>();

export function enqueueMessage(userId: string, message: string): void {
  if (!messageQueues.has(userId)) {
    messageQueues.set(userId, []);
    batchStartTimestamps.set(userId, devNow().toISOString());
    console.log(
      `[Queue] New batch started for client "${userId}" — processing deferred to next hourly cron tick`,
    );
  }
  messageQueues.get(userId)!.push(message);
}

async function processBatch(userId: string, anchoredTimestamp?: string): Promise<void> {
  const queue = messageQueues.get(userId);
  messageQueues.delete(userId);

  if (!queue || queue.length === 0) {
    return;
  }

  try {
    console.log(
      `[Batch] Processing batch of ${queue.length} messages for "${userId}" (anchor=${anchoredTimestamp ?? 'now'})`,
    );

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

    const latestGm = updatedState.gm_log[updatedState.gm_log.length - 1];
    const latestGmStr = latestGm ? `[${latestGm.timestamp}] "${latestGm.message}"` : '[None]';

    console.log(
      `[Batch Processed] userId="${userId}"\n` +
        `  - Messages: ${JSON.stringify(queue)}\n` +
        `  - Classification: ${result ? `isValidGM=${result.is_valid_gm} | Reasoning: "${result.reasoning}"` : '[Error/Timeout]'}\n` +
        `  - Compliance Status: ${updatedState.compliance_status}\n` +
        `  - Streak Count: ${updatedState.streak_count}\n` +
        `  - Latest GM Log Entry: ${latestGmStr}`,
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

/**
 * Executes all cron/compliance tasks for a given hour tick:
 *   1. Flushes any pending message batch.
 *   2. Runs compliance check at midnight (local hour 0).
 *   3. Selects and logs the compliance reply at 5pm (local hour 17).
 */
export async function executeHourlyTick(
  clientId: string,
  now: Date,
): Promise<{ triggeredMidnight: boolean }> {
  let triggeredMidnight = false;

  // Step 1: Always flush any pending batch first
  await flushPendingBatch(clientId);

  // Step 2: At midnight only, run the compliance day-transition check
  const isMidnight = now.getHours() === 0;
  if (isMidnight) {
    console.log(`[Scheduler] Midnight tick — running compliance check for client "${clientId}"`);
    loadClient(clientId, now.toISOString());
    console.log(`[Scheduler] Compliance check complete for client "${clientId}"`);
    triggeredMidnight = true;
  }

  // Step 3: At 5pm local time, select and log the daily compliance reply
  const clientState = loadClient(clientId, now.toISOString());
  const localHour = getLocalHour(clientState.timezone);
    if (localHour === 17) {
      const reply = select5pmReply(clientState);
      logMessage(clientId, '[BOT]', reply, now.toISOString(), 'outbound');
      console.log(`[Scheduler] 5pm reply logged for client "${clientId}": "${reply}"`);
      await sendTelegramReply(clientId, reply);
    }

  return { triggeredMidnight };
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

    console.log(`[webhook] Received message from "${userId}": "${message}"`);

    // Log the message for the dev dashboard
    logMessage(userId, userId, message, devNow().toISOString(), 'inbound');

    // 1. Respond with HTTP 200 OK after successful validation
    res.sendStatus(200);

    // Enqueue message in-memory
    enqueueMessage(userId, message);
  });

  app.post('/dev/advance-day', async (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    let lastTriggeredMidnight = false;

    // Loop 24 times to simulate 24 sequential hourly ticks
    for (let i = 0; i < 24; i++) {
      advance1Hour();
      if (clientId) {
        try {
          const result = await executeHourlyTick(clientId, devNow());
          if (result.triggeredMidnight) {
            lastTriggeredMidnight = true;
          }
        } catch (err) {
          console.error(`[dev] Error running hourly tick during day advance (hour ${i + 1}):`, err);
        }
      }
    }

    res.json({
      success: true,
      offsetMs: getOffsetMs(),
      devTime: devNow().toISOString(),
      triggeredMidnight: lastTriggeredMidnight,
    });
  });

  app.post('/dev/advance-1hour', async (req: Request, res: Response) => {
    advance1Hour();
    const now = devNow();
    let triggeredMidnight = false;

    const clientId = resolveClientId(req);
    if (clientId) {
      try {
        console.log(`[dev] +1hour advanced clock, running hourly tick for "${clientId}"...`);
        const result = await executeHourlyTick(clientId, now);
        triggeredMidnight = result.triggeredMidnight;
      } catch (err) {
        console.error('[dev] Error running post-advance-1hour actions:', err);
      }
    }

    res.json({
      success: true,
      offsetMs: getOffsetMs(),
      devTime: now.toISOString(),
      crossedHourBoundary: true,
      triggeredMidnight,
    });
  });

  app.post('/dev/reset-clock', (req: Request, res: Response) => {
    resetClock();
    res.json({
      success: true,
      offsetMs: getOffsetMs(),
      devTime: devNow().toISOString(),
    });
  });

  app.post('/dev/run-compliance-check', (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    try {
      const now = devNow();
      const state = loadClient(clientId, now.toISOString());
      saveClient(state);
      console.log(`[dev] Manual compliance check for "${clientId}" — status: ${state.compliance_status}`);
      res.json({
        success: true,
        clientId,
        compliance_status: state.compliance_status,
        devTime: now.toISOString(),
      });
    } catch (err) {
      console.error('[dev] Error running manual compliance check:', err);
      res.status(500).json({ error: `Error running compliance check: ${(err as Error).message}` });
    }
  });

  app.post('/dev/reset', (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    console.log(`[dev] Wiping client state for "${clientId}"...`);
    try {
      const newState = resetClient(clientId);
      res.json({
        success: true,
        clientId,
        state: newState,
      });
    } catch (err) {
      console.error('[dev] Error resetting client state:', err);
      res.status(500).json({ error: `Error resetting client state: ${(err as Error).message}` });
    }
  });

  app.get('/dev/clock', (req: Request, res: Response) => {
    res.json({
      offsetMs: getOffsetMs(),
      devTime: devNow().toISOString(),
    });
  });

  app.get('/dev/api/roster', (req: Request, res: Response) => {
    const clients = getRoster().map(id => {
      let handle = id;
      try {
        if (clientExists(id)) {
          const state = loadClient(id);
          handle = state.client_handle || id;
        }
      } catch (err) {
        console.error(`Error loading state for roster client ${id}:`, err);
      }
      return { id, handle };
    });
    res.json({ clients });
  });

  app.get('/dev/api/state', (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    let state;
    try {
      if (!clientExists(clientId)) {
        createClient(clientId, 'America/New_York');
      }
      state = loadClient(clientId);
    } catch (err) {
      res.status(500).json({ error: `Error loading client state: ${(err as Error).message}` });
      return;
    }

    res.json({
      state,
      clock: {
        offsetMs: getOffsetMs(),
        devTime: devNow().toISOString(),
      },
    });
  });

  app.get('/dev/api/messages', (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    res.json(getMessages(clientId));
  });

  app.post('/dev/api/suggestions/generate', async (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    try {
      const suggestion = await generateSuggestion(clientId);
      res.json({ success: true, suggestion });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('No new messages found')) {
        res.status(400).json({ success: false, error: message });
      } else {
        res.status(500).json({ success: false, error: message });
      }
    }
  });

  app.post('/dev/api/suggestions/send', async (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    const { suggestion } = req.body;
    try {
      const latest = getLatestSuggestion(clientId);
      if (!latest && !suggestion) {
        res.status(400).json({ success: false, error: 'No suggestion to send' });
        return;
      }
      const textToSend = suggestion ?? latest!.suggestion;
      markSuggestionSent(clientId, suggestion);
      await sendTelegramReply(clientId, textToSend);
      res.json({ success: true, sentAt: devNow().toISOString() });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  app.get('/dev/api/suggestions', (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    const suggestion = getLatestSuggestion(clientId);
    res.json({ suggestion });
  });

  app.get('/dev/dashboard', (req: Request, res: Response) => {
    const clientId = resolveClientId(req);
    res.send(getDashboardHtml(clientId));
  });

  app.listen(Number(port), () => {
    console.log(`Bot webhook server listening on port ${port}`);
  });
}

function PatternApp() {
  return express();
}
