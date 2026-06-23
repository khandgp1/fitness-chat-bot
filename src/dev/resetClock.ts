import 'dotenv/config';

const port = process.env.BOT_PORT || '4000';

async function main() {
  try {
    const res = await fetch(`http://localhost:${port}/dev/reset-clock`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    console.log('🔄 Reset dev clock offset:', data);
  } catch (error) {
    console.error('❌ Failed to reset clock:', error);
    process.exit(1);
  }
}

main();
