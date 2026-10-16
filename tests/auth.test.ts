import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { contentSecurityPolicy, createApp } from '../server/app.ts';
import { hashPassphrase, verifyPassphrase } from '../server/auth/passphrase.ts';
import { MemoryAuthStore } from '../server/auth/store.ts';
import { readCookie, sessionCookie } from '../server/auth/service.ts';

const PASS = 'correct horse battery staple';
const headers = { host: 'localhost:3002', 'content-type': 'application/json' };

test('passphrases are hashed with a salt and verified in constant time', async () => {
  const a = await hashPassphrase(PASS);
  const b = await hashPassphrase(PASS);
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.salt, b.salt);
  assert.ok(!JSON.stringify(a).includes(PASS));
  assert.equal(await verifyPassphrase(PASS, a), true);
  assert.equal(await verifyPassphrase(PASS + 'x', a), false);
  await assert.rejects(hashPassphrase('short'), /at least 12/);
});

test('cookies are parsed and set with the safe attributes', () => {
  assert.equal(readCookie('a=1; sw_session=abc%20d; b=2', 'sw_session'), 'abc d');
  assert.equal(readCookie(undefined, 'sw_session'), undefined);
  const c = sessionCookie('tok', false);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.doesNotMatch(c, /Secure/);
  assert.match(sessionCookie('tok', true), /Secure/);
});

async function appWithPassphrase(delay = 0) {
  const store = new MemoryAuthStore();
  store.passphrase = await hashPassphrase(PASS);
  return { store, app: await createApp({ authStore: store, failureDelayMs: delay }) };
}
const login = (app: any, passphrase: unknown) =>
  app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { passphrase } });

test('once a passphrase is set the API requires a session, except health and status', async () => {
  const { app } = await appWithPassphrase();
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/overview', headers })).statusCode,
    401,
  );
  assert.equal((await app.inject({ method: 'GET', url: '/api/export', headers })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/sync', headers })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/health', headers })).statusCode, 200);
  const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers });
  assert.deepEqual(status.json(), {
    required: true,
    configured: true,
    authenticated: false,
    setup: false,
  });
  await app.close();
});

test('wrong passphrase is rejected; the right one gives a working session cookie', async () => {
  const { app, store } = await appWithPassphrase();
  const wrong = await login(app, 'not the passphrase');
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.headers['set-cookie'], undefined);
  assert.equal((await login(app, 12345)).statusCode, 401);
  const ok = await login(app, PASS);
  assert.equal(ok.statusCode, 200);
  const cookie = String(ok.headers['set-cookie']).split(';')[0];
  assert.match(String(ok.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  // The raw token is never stored, only its hash.
  const raw = cookie.split('=')[1];
  assert.ok(![...store.sessions.keys()].includes(raw));
  assert.equal(store.sessions.size, 1);
  const withCookie = { ...headers, cookie };
  assert.deepEqual(
    (await app.inject({ method: 'GET', url: '/api/auth/status', headers: withCookie })).json(),
    {
      required: true,
      configured: true,
      authenticated: true,
      setup: false,
    },
  );
  // A request that carries the cookie gets past the gate (the unknown path then 404s).
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/nope', headers: withCookie })).statusCode,
    404,
  );
  assert.equal((await app.inject({ method: 'GET', url: '/api/nope', headers })).statusCode, 401);
  const out = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: withCookie,
    payload: {},
  });
  assert.equal(out.statusCode, 200);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/nope', headers: withCookie })).statusCode,
    401,
  );
  await app.close();
});

test('five wrong attempts lock sign-in, even for the right passphrase', async () => {
  const { app } = await appWithPassphrase();
  for (let i = 0; i < 5; i++) assert.equal((await login(app, 'nope-nope-nope')).statusCode, 401);
  const locked = await login(app, PASS);
  assert.equal(locked.statusCode, 429);
  assert.match(locked.json().error, /Too many attempts/);
  await app.close();
});

test('changing the passphrase signs every device out', async () => {
  const { app, store } = await appWithPassphrase();
  const cookie = String((await login(app, PASS)).headers['set-cookie']).split(';')[0];
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/nope', headers: { ...headers, cookie } }))
      .statusCode,
    404,
  );
  await store.setPassphrase(await hashPassphrase('another long passphrase'));
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/nope', headers: { ...headers, cookie } }))
      .statusCode,
    401,
  );
  await app.close();
});

test('with no passphrase and localhost-only mode the app stays open', async () => {
  const app = await createApp({ authStore: new MemoryAuthStore(), failureDelayMs: 0 });
  const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers });
  assert.deepEqual(status.json(), {
    required: false,
    configured: false,
    authenticated: false,
    setup: true,
  });
  assert.equal((await app.inject({ method: 'GET', url: '/api/nope', headers })).statusCode, 404);
  assert.equal((await login(app, PASS)).statusCode, 503);
  await app.close();
});

test('lockout is per client address: one address cannot lock another out', async () => {
  const { app } = await appWithPassphrase();
  const from = (remoteAddress: string, passphrase: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      remoteAddress,
      payload: { passphrase },
    });
  for (let i = 0; i < 5; i++)
    assert.equal((await from('10.1.1.1', 'wrong wrong wrong')).statusCode, 401);
  assert.equal((await from('10.1.1.1', PASS)).statusCode, 429);
  assert.equal((await from('10.2.2.2', PASS)).statusCode, 200);
});

test('responses carry security headers, and the policy allows only the inline script it hashes', async () => {
  const { app } = await appWithPassphrase();
  const r = await app.inject({ method: 'GET', url: '/api/health', headers });
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.match(String(r.headers['content-security-policy']), /frame-ancestors 'none'/);
  const policy = contentSecurityPolicy('<script>var a=1</script><script src="/x.js"></script>');
  const hash = crypto.createHash('sha256').update('var a=1').digest('base64');
  assert.match(policy, new RegExp(`'sha256-${hash.replace(/[+/=]/g, '\\$&')}'`));
  assert.equal(policy.match(/sha256-/g)?.length, 1);
  assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline/);
});

// First-run setup and changing the passphrase, both in the browser.
const post = (app: any, url: string, payload: unknown, extra: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, headers: { ...headers, ...extra }, payload });
const setup = (app: any, passphrase: unknown) => post(app, '/api/auth/setup', { passphrase });
const change = (app: any, cookie: string | undefined, current: unknown, passphrase: unknown) =>
  post(app, '/api/auth/passphrase', { current, passphrase }, cookie ? { cookie } : {});
const cookieOf = (res: any) => String(res.headers['set-cookie']).split(';')[0];
const gate = (app: any, cookie?: string) =>
  app.inject({
    method: 'GET',
    url: '/api/nope',
    headers: cookie ? { ...headers, cookie } : headers,
  });

async function freshLanApp() {
  const store = new MemoryAuthStore();
  return { store, app: await createApp({ authStore: store, failureDelayMs: 0, lan: true }) };
}

test('with the app open on the LAN and no passphrase, the status offers setup and data stays blocked', async () => {
  const { app } = await freshLanApp();
  const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers });
  assert.deepEqual(status.json(), {
    required: true,
    configured: false,
    authenticated: false,
    setup: true,
  });
  assert.equal((await gate(app)).statusCode, 401);
  assert.equal((await login(app, PASS)).statusCode, 503);
  await app.close();
});

test('setup stores the passphrase, signs in, and is closed for good afterwards', async () => {
  const { app, store } = await freshLanApp();
  const ok = await setup(app, PASS);
  assert.equal(ok.statusCode, 200);
  assert.match(String(ok.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  assert.equal((await gate(app, cookieOf(ok))).statusCode, 404);
  assert.ok(!JSON.stringify(store.passphrase).includes(PASS));
  assert.equal((await login(app, PASS)).statusCode, 200);
  assert.equal((await setup(app, 'a different passphrase')).statusCode, 409);
  assert.equal((await login(app, 'a different passphrase')).statusCode, 401);
  await app.close();
});

test('setup refuses a short or missing passphrase and stores nothing', async () => {
  const { app, store } = await freshLanApp();
  const short = await setup(app, 'short');
  assert.equal(short.statusCode, 400);
  assert.match(short.json().error, /at least 12/);
  assert.equal((await post(app, '/api/auth/setup', {})).statusCode, 400);
  assert.equal(store.passphrase, null);
  await app.close();
});

test('setup never replaces an existing passphrase or signs anyone out', async () => {
  const { app, store } = await appWithPassphrase();
  const cookie = cookieOf(await login(app, PASS));
  const before = JSON.stringify(store.passphrase);
  assert.equal((await setup(app, 'another long passphrase')).statusCode, 409);
  assert.equal(JSON.stringify(store.passphrase), before);
  assert.equal(store.sessions.size, 1);
  assert.equal((await gate(app, cookie)).statusCode, 404);
  await app.close();
});

test('two setups at once: exactly one wins', async () => {
  const { app, store } = await freshLanApp();
  const [a, b] = await Promise.all([
    setup(app, 'first long passphrase'),
    setup(app, 'second long passphrase'),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  assert.equal(store.sessions.size, 1);
  await app.close();
});

test('localhost-only mode can set the first passphrase too, and then asks for it', async () => {
  const store = new MemoryAuthStore();
  const app = await createApp({ authStore: store, failureDelayMs: 0 });
  assert.equal((await gate(app)).statusCode, 404);
  assert.equal((await setup(app, PASS)).statusCode, 200);
  assert.equal((await gate(app)).statusCode, 401);
  await app.close();
});

test('changing the passphrase needs a session', async () => {
  const { app, store } = await appWithPassphrase();
  const before = JSON.stringify(store.passphrase);
  assert.equal((await change(app, undefined, PASS, 'another long passphrase')).statusCode, 401);
  assert.equal(JSON.stringify(store.passphrase), before);
  await app.close();
});

test('changing the passphrase: a wrong current one is refused and counts toward the lockout', async () => {
  const { app, store } = await appWithPassphrase();
  const cookie = cookieOf(await login(app, PASS));
  const before = JSON.stringify(store.passphrase);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await change(app, cookie, 'not the passphrase', 'another long passphrase')).statusCode,
      401,
    );
  assert.equal(JSON.stringify(store.passphrase), before);
  // The lockout is shared with sign-in.
  assert.equal((await change(app, cookie, PASS, 'another long passphrase')).statusCode, 429);
  assert.equal((await login(app, PASS)).statusCode, 429);
  await app.close();
});

test('changing the passphrase: a short new one is refused and the old one keeps working', async () => {
  const { app } = await appWithPassphrase();
  const cookie = cookieOf(await login(app, PASS));
  const short = await change(app, cookie, PASS, 'short');
  assert.equal(short.statusCode, 400);
  assert.match(short.json().error, /at least 12/);
  assert.equal((await change(app, cookie, PASS, undefined)).statusCode, 400);
  assert.equal((await login(app, PASS)).statusCode, 200);
  await app.close();
});

test('changing the passphrase signs other devices out but keeps this browser signed in', async () => {
  const { app, store } = await appWithPassphrase();
  const mine = cookieOf(await login(app, PASS));
  const other = cookieOf(await login(app, PASS));
  const NEXT = 'another long passphrase';
  const res = await change(app, mine, PASS, NEXT);
  assert.equal(res.statusCode, 200);
  const fresh = cookieOf(res);
  assert.match(String(res.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  assert.equal((await gate(app, fresh)).statusCode, 404);
  assert.equal((await gate(app, mine)).statusCode, 401);
  assert.equal((await gate(app, other)).statusCode, 401);
  assert.equal(store.sessions.size, 1);
  assert.equal((await login(app, PASS)).statusCode, 401);
  assert.equal((await login(app, NEXT)).statusCode, 200);
  assert.ok(!JSON.stringify(store.passphrase).includes(NEXT));
  await app.close();
});
