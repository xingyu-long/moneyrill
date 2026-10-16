// Prints a one-time setup code for choosing the first passphrase in the browser (LAN mode).
// Run on the host: ./scripts/setup-code.sh [production|staging]. Does nothing once a passphrase exists.
import { migrate } from './db/migrate.ts';
import { pool } from './db/pool.ts';
import { DbAuthStore } from './auth/store.ts';
import { newSetupCode } from './auth/setup-code.ts';

try {
  await migrate();
  const store = new DbAuthStore();
  if (await store.getPassphrase()) {
    console.log('A passphrase is already set; no setup code is needed.');
  } else {
    const { code, record } = newSetupCode();
    await store.setSetupCode(record);
    console.log(`Setup code: ${code} (valid for 1 hour). Open the app in a browser and enter it.`);
  }
} catch (e: any) {
  console.error('Could not create a setup code: ' + e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
