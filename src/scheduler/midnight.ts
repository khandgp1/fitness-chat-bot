import cron, { ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';
import { loadClient, getDataDir } from '../state/store.js';

/**
 * Starts the hourly scheduler to check and process midnight transitions
 * for all enrolled clients in their respective local timezones.
 */
export function startMidnightScheduler(): ScheduledTask {
  console.log('Starting midnight scheduler (hourly checks)...');

  // Schedule a task to run at the top of every hour: '0 * * * *'
  const task = cron.schedule('0 * * * *', () => {
    console.log(`[Scheduler] Hourly check started at ${new Date().toISOString()}`);

    try {
      const dataDir = getDataDir();
      if (!fs.existsSync(dataDir)) {
        console.log('[Scheduler] Data directory does not exist yet. Skipping check.');
        return;
      }

      const files = fs.readdirSync(dataDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      let processedCount = 0;
      for (const file of jsonFiles) {
        const clientId = path.basename(file, '.json');
        try {
          // loadClient automatically transitions the client's day
          // and saves the updated state if a day boundary was crossed.
          loadClient(clientId);
          processedCount++;
        } catch (error) {
          console.error(`[Scheduler] Error processing client "${clientId}":`, error);
        }
      }

      console.log(`[Scheduler] Hourly check complete. Processed ${processedCount} clients.`);
    } catch (error) {
      console.error('[Scheduler] Critical error during hourly check:', error);
    }
  });

  return task;
}
