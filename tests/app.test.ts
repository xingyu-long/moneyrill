import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.ts';
import { MemoryAuthStore } from '../server/auth/store.ts';

// These requests are rejected before any database access, so no database is needed.
const app = await createApp({ authStore: new MemoryAuthStore(), failureDelayMs: 0 });
test.after(() => app.close());

const call = (opts: any) => app.inject(opts);

test('API refuses non-local hosts and cross-site requests', async () => {
  const host = await call({ method: 'GET', url: '/api/health', headers: { host: 'evil.example' } });
  assert.equal(host.statusCode, 403);
  const origin = await call({
    method: 'GET',
    url: '/api/health',
    headers: { host: 'localhost:3002', origin: 'https://example.com' },
  });
  assert.equal(origin.statusCode, 403);
  const site = await call({
    method: 'GET',
    url: '/api/health',
    headers: { host: 'localhost:3002', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(site.statusCode, 403);
});

test('health works locally and unknown API paths return 404 JSON', async () => {
  const ok = await call({ method: 'GET', url: '/api/health', headers: { host: 'localhost:3002' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().ok, true);
  // Built images carry their git commit and build time; a local run reports "dev".
  assert.equal(typeof ok.json().version.commit, 'string');
  assert.ok(ok.json().version.commit.length > 0);
  const missing = await call({
    method: 'GET',
    url: '/api/nope',
    headers: { host: 'localhost:3002' },
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: 'Unknown endpoint' });
});

test('invalid manual accounts and archives are rejected with a clear message', async () => {
  const headers = { host: 'localhost:3002', 'content-type': 'application/json' };
  const account = await call({
    method: 'POST',
    url: '/api/accounts',
    headers,
    payload: { name: '', kind: 'cash', balance: '1' },
  });
  assert.equal(account.statusCode, 400);
  assert.equal(account.json().error, 'Enter a name, account type and valid balance');
  const archive = await call({
    method: 'POST',
    url: '/api/import',
    headers,
    payload: { version: 2 },
  });
  assert.equal(archive.statusCode, 400);
  assert.equal(archive.json().error, 'Select a Moneyrill version 1 JSON archive');
  for (const balance of ['', 'abc', null, true]) {
    const res = await call({
      method: 'POST',
      url: '/api/accounts',
      headers,
      payload: { name: 'x', kind: 'cash', balance },
    });
    assert.equal(res.statusCode, 400);
  }
  const link = await call({
    method: 'POST',
    url: '/api/link',
    headers,
    payload: { connectionId: 5 },
  });
  assert.equal(link.statusCode, 400);
  assert.equal(link.json().error, 'Invalid request');
});

test('sandbox-only operations are blocked in staging-safe ways', async () => {
  const headers = { host: 'localhost:3002', 'content-type': 'application/json' };
  const res = await call({
    method: 'POST',
    url: '/api/exchange',
    headers,
    payload: { public_token: 'public-production-not-allowed' },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /sandbox token is required/);
});
