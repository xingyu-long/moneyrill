// One-time migration helper. Read the existing Item through stdin, never arguments/logs.
import { storeExistingConnection } from './services/connections.ts';
import { syncAll } from './services/sync.ts';
import { pool } from './db/pool.ts';
import { migrate } from './db/migrate.ts';
import { config } from './lib/config.ts';
try {
  if (!config.production) throw new Error('Existing live Item migration requires production');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const value = JSON.parse(input);
  await migrate();
  await storeExistingConnection(value.access_token, value.item_id);
  console.log('Existing production Item saved with the production encryption key.');
  const result = await syncAll();
  console.log(JSON.stringify(result));
  if (result.status !== 'success') process.exitCode = 1;
} catch (e: any) {
  console.error('Item migration failed: ' + (e.response?.data?.error_code || e.message));
  process.exitCode = 1;
} finally {
  await pool.end();
}
