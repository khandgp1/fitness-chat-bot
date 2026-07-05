import cron, { ScheduledTask } from 'node-cron';
import { devNow } from '../dev/clock.js';
import { executeHourlyTick } from '../bot/bot.js';
import { getRoster } from '../state/clientRoster.js';

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

    const clients = getRoster();
    if (clients.length === 0) {
      console.warn('[Scheduler] CLIENT_ROSTER is empty. Skipping tick.');
      return;
    }

    console.log(`[Scheduler] Ticking ${clients.length} client(s): ${clients.join(', ')}`);
    try {
      await Promise.all(
        clients.map((clientId) =>
          executeHourlyTick(clientId, now).catch((err) =>
            console.error(`[Scheduler] Error during tick for "${clientId}":`, err),
          ),
        ),
      );
    } catch (error) {
      console.error('[Scheduler] Unexpected error during hourly tick execution:', error);
    }
  });

  return task;
}
