import cron, { ScheduledTask } from 'node-cron';
import { loadClient } from '../state/store.js';
import { flushPendingBatch } from '../bot/bot.js';
import { devNow } from '../dev/clock.js';

/**
 * Starts the hourly scheduler that runs at the top of every hour.
 *
 * On each tick it:
 *   1. Flushes any pending message batch for the configured client (no-op if queue is empty).
 *   2. At midnight only (hour === 0), runs the compliance day-transition check via loadClient.
 *
 * This replaces the former midnight-only scheduler and the 30-minute setTimeout in bot.ts.
 */
export function startHourlyScheduler(): ScheduledTask {
  console.log('Starting hourly batch + compliance scheduler (0 * * * *)...');

  const task = cron.schedule('0 * * * *', async () => {
    const now = devNow();
    console.log(`[Scheduler] Hourly tick at ${now.toISOString()}`);

    const clientId = process.env.BOT_CLIENT_ID;
    if (!clientId) {
      console.warn('[Scheduler] BOT_CLIENT_ID is not configured in environment. Skipping tick.');
      return;
    }

    try {
      // Step 1: Always flush any pending batch first, using the anchored timestamp
      // recorded when the first message arrived.
      await flushPendingBatch(clientId);

      // Step 2: At midnight only, run the compliance day-transition check.
      // This catches days where no message was received and marks them as Miss.
      const isMidnight = now.getHours() === 0;
      if (isMidnight) {
        console.log(
          `[Scheduler] Midnight tick — running compliance check for client "${clientId}"`,
        );
        loadClient(clientId);
        console.log(`[Scheduler] Compliance check complete for client "${clientId}"`);
      }
    } catch (error) {
      console.error('[Scheduler] Error during hourly tick:', error);
    }
  });

  return task;
}
