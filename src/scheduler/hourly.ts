import cron, { ScheduledTask } from 'node-cron';
import { devNow } from '../dev/clock.js';
import { executeHourlyTick } from '../bot/bot.js';

/**
 * Starts the hourly scheduler that runs at the top of every hour.
 *
 * On each tick it delegates all compliance, batch flushing, and 5pm reply checks
 * to the shared executeHourlyTick function.
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
      await executeHourlyTick(clientId, now);
    } catch (error) {
      console.error('[Scheduler] Error during hourly tick:', error);
    }
  });

  return task;
}
