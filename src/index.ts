import 'dotenv/config';
import { startHourlyScheduler } from './scheduler/hourly.js';
import { startBotServer } from './bot/bot.js';
import { startTelegramBot } from './bot/telegramBot.js';

// Start the hourly batch + compliance scheduler
startHourlyScheduler();

// Start the sandbox Express server
startBotServer();

// Start the Telegram bot (skipped if TELEGRAM_BOT_TOKEN is not configured)
startTelegramBot();

console.log('GM Ritual Bot has successfully started.');

// Handle graceful shutdown
process.once('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
