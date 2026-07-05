import { Bot } from 'grammy';
import { enqueueMessage } from './bot.js';
import { devNow } from '../dev/clock.js';
import { logMessage } from '../dev/messageLog.js';
import { clientExists, createClient } from '../state/store.js';

const telegramChatIds = new Map<string, number>();
let botInstance: Bot | null = null;

/**
 * Initializes the Telegram bot using Grammy, registers text message handlers,
 * and starts long polling.
 */
export function startTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'placeholder_telegram_bot_token') {
    console.warn(
      '[Telegram] TELEGRAM_BOT_TOKEN is missing or set to placeholder. Skipping Telegram bot start.',
    );
    return;
  }

  console.log('[Telegram] Starting Telegram bot...');
  botInstance = new Bot(token);

  // Register text handler
  botInstance.on('message:text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id;
    const message = ctx.message.text;

    // Store the chatId for this userId so we can reply during batch flush
    telegramChatIds.set(userId, chatId);

    console.log(`[Telegram] Received message from "${userId}": "${message}"`);

    // Log the message in memory for the dev dashboard
    logMessage(userId, message, devNow().toISOString());

    // Auto-register client state if it doesn't exist
    if (!clientExists(userId)) {
      console.log(`[Telegram] Client "${userId}" does not exist. Creating new client...`);
      createClient(userId, 'America/New_York');
    }

    // Enqueue message into the batch queue
    enqueueMessage(userId, message);
  });

  // Handle errors gracefully without crashing the app
  botInstance.catch((err) => {
    console.error('[Telegram] Bot error occurred:', err);
  });

  // Start polling asynchronously
  botInstance.start({
    onStart: (botInfo) => {
      console.log(`[Telegram] Bot started successfully as @${botInfo.username}`);
    },
  });
}

/**
 * Sends a message back to the Telegram user via the chat ID stored when they messaged the bot.
 */
export async function sendTelegramReply(userId: string, text: string): Promise<void> {
  if (!botInstance) {
    console.warn(`[Telegram] Cannot send reply to "${userId}". Bot instance is not running.`);
    return;
  }

  const chatId = telegramChatIds.get(userId);
  if (!chatId) {
    console.warn(`[Telegram] Stored chatId not found for user "${userId}". Reply skipped.`);
    return;
  }

  try {
    console.log(`[Telegram] Sending reply to "${userId}" (chatId=${chatId}): "${text}"`);
    await botInstance.api.sendMessage(chatId, text);
  } catch (err) {
    console.error(`[Telegram] Failed to send message to user "${userId}":`, err);
  }
}

export function getTelegramBot(): Bot | null {
  return botInstance;
}
