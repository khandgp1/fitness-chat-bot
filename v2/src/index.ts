import 'dotenv/config';
import { buildApp } from './app.js';

const app = buildApp();

app.start().catch((err) => {
  console.error('[boot] failed:', err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[shutdown] ${signal}`);
    void app.stop().then(() => process.exit(0));
  });
}
