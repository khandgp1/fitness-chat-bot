import 'dotenv/config';
import { startMidnightScheduler } from './scheduler/midnight.js';
import { startBotServer } from './bot/bot.js';

// Start the midnight scheduler
startMidnightScheduler();

// Start the sandbox Express server
startBotServer();

console.log('GM Ritual Bot has successfully started in Sandbox mode.');

// Handle graceful shutdown
process.once('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
