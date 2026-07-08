import { Bot } from 'grammy';
import type { ChannelAdapter } from './types.js';

/** Grammy long-polling adapter. Token validated at start() via bot.init(). */
export function createTelegramAdapter(opts: { token: string }): ChannelAdapter {
  const bot = new Bot(opts.token);
  let started = false;

  return {
    name: 'telegram',

    async start(onMessage) {
      bot.on('message:text', (ctx) => {
        const from = ctx.message.from;
        const displayName =
          [from.first_name, from.last_name].filter(Boolean).join(' ') || undefined;
        onMessage({
          channel: 'telegram',
          externalId: String(ctx.chat.id),
          handle: from.username !== undefined ? `@${from.username}` : undefined,
          displayName,
          text: ctx.message.text,
          channelMessageRef: String(ctx.message.message_id),
          rawPayload: JSON.stringify(ctx.message),
        });
      });

      await bot.init(); // validates the token before we claim to be listening
      started = true;
      void bot.start(); // long polling; resolves only when stopped
      console.log(`[telegram] @${bot.botInfo.username} listening (long polling)`);
    },

    async stop() {
      if (started) await bot.stop();
      started = false;
    },

    async send(externalId, text) {
      await bot.api.sendMessage(externalId, text);
    },
  };
}
