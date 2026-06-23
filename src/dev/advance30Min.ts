import 'dotenv/config';

const port = process.env.BOT_PORT || '4000';

async function main() {
  try {
    const res = await fetch(`http://localhost:${port}/dev/advance-30min`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    console.log('⏩ Advanced dev clock by +30 minutes:', data);
  } catch (error) {
    console.error('❌ Failed to advance clock by 30 minutes:', error);
    process.exit(1);
  }
}

main();
