import { migrate } from './db/migrate.ts';
import { pool } from './db/pool.ts';
import { seed, seedReportHistory, seedTransactions } from './db/seed.ts';
import { remapAutoCategories } from './services/transactions.ts';
import { createApp } from './app.ts';
import { tokenKeyProblem } from './services/token-crypto.ts';
import { log } from './lib/log.ts';

// Say it at start-up, not at the first sync; the app still runs (manual accounts and reports do not need the key).
const keyProblem = tokenKeyProblem();
if (keyProblem) log.error('config.token_key', { problem: keyProblem });
await migrate();
await seed();
await seedTransactions();
await seedReportHistory();
await remapAutoCategories();
const app = await createApp();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3002) });
process.on('SIGTERM', async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
