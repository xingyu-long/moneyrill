// Sets (or with --clear removes) the sign-in passphrase. The passphrase is read from stdin,
// never from arguments: ./scripts/set-passphrase.sh [production|staging] [--clear]
import { migrate } from './db/migrate.ts';
import { pool } from './db/pool.ts';
import { DbAuthStore } from './auth/store.ts';
import { hashPassphrase } from './auth/passphrase.ts';

try {
  await migrate();
  const store = new DbAuthStore();
  if (process.argv.includes('--clear')) {
    await store.setPassphrase(null);
    console.log('Passphrase removed. All sessions signed out.');
  } else {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    await store.setPassphrase(await hashPassphrase(input.replace(/\r?\n$/, '')));
    console.log('Passphrase saved. All devices were signed out.');
  }
} catch (e: any) {
  console.error('Could not set passphrase: ' + e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
