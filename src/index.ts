import 'dotenv/config';

function main(): void {
  console.log('Bot scaffolding ready.');
  console.log(`Node version: ${process.version}`);
  console.log(`TELEGRAM_BOT_TOKEN set: ${Boolean(process.env.TELEGRAM_BOT_TOKEN)}`);
  console.log(`ANTHROPIC_API_KEY set: ${Boolean(process.env.ANTHROPIC_API_KEY)}`);
}

main();
