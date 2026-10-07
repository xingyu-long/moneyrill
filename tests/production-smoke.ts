// Run only against a disposable database, with no Plaid credentials.
import assert from 'node:assert/strict';
import { pool } from '../server/db/pool.ts';
assert.equal(process.env.PLAID_SECRET, '');
async function api(route: string, body?: unknown) {
  const r = await fetch('http://localhost:3002/api' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
for (let i = 0; i < 60; i++) {
  try {
    if ((await api('/health')).status === 200) break;
  } catch {
    // not ready yet
  }
  await new Promise((r) => setTimeout(r, 500));
}
let overview = (await api('/overview')).data;
assert.equal(overview.mode, 'production');
assert.equal(overview.accounts.length, 0);
assert.equal(overview.benchmarks.length, 0);
assert.equal((await api('/sandbox-samples', {})).status, 403);
assert.equal(
  (await api('/exchange', { public_token: 'public-sandbox-test', products: ['transactions'] }))
    .status,
  400,
);
assert.equal(
  (await api('/import', { version: 1, environment: 'sandbox', tables: { accounts: [] } })).status,
  400,
);
assert.equal(
  (
    await api('/import', {
      version: 1,
      environment: 'production',
      tables: { accounts: [], benchmark_observations: [{ provenance: 'simulated' }] },
    })
  ).status,
  400,
);
assert.equal(
  (await api('/accounts', { name: 'Verification only', kind: 'cash', balance: '42' })).status,
  200,
);
overview = (await api('/overview')).data;
assert.equal(overview.accounts.length, 1);
assert.equal(overview.accounts[0].source, 'manual');
assert.equal((await api('/export')).data.environment, 'production');
assert.equal(
  (await pool.query("SELECT value FROM settings WHERE key='environment'")).rows[0].value,
  'production',
);
console.log(
  'PASS: production starts empty, blocks Sandbox tokens/samples/archives, accepts manual accounts, labels exports',
);
await pool.end();
