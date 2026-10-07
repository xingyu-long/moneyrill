// Black-box smoke test of a running environment. No data is created or changed, and it works
// whether or not a passphrase has been created yet.   tsx tests/smoke.ts BASE_URL EXPECTED_MODE
//   tsx tests/smoke.ts http://localhost:3002 sandbox
//   tsx tests/smoke.ts http://localhost:3003 production [COMMIT]   (COMMIT: must be the one running)
import http from 'node:http';

const base = process.argv[2];
const mode = process.argv[3];
const expectedCommit = process.argv[4]; // optional: the commit that was just deployed
if (!base || !mode) {
  console.error('Usage: tsx tests/smoke.ts BASE_URL sandbox|production');
  process.exit(2);
}

/** fetch() silently ignores a custom Host header, so spoof it with a raw request. */
function statusWithHost(path: string, host: string) {
  const url = new URL(base);
  return new Promise<number>((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path, headers: { Host: host } },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { headers, redirect: 'manual' });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, text, json };
}

try {
  const health = await get('/api/health');
  add('health answers', health.status === 200 && health.json?.ok === true, `HTTP ${health.status}`);
  add(`runs in ${mode} mode`, health.json?.mode === mode, `reports "${health.json?.mode}"`);

  const v = health.json?.version;
  add(
    expectedCommit ? `serves commit ${expectedCommit}` : 'reports a version',
    expectedCommit ? String(v?.commit ?? '').startsWith(expectedCommit) : !!v?.commit,
    `reports ${v?.commit}`,
  );

  const status = await get('/api/auth/status');
  const sign = status.json;
  add(
    'sign-in status is well formed',
    status.status === 200 &&
      typeof sign?.configured === 'boolean' &&
      typeof sign?.authenticated === 'boolean',
    JSON.stringify(sign),
  );
  if (sign?.configured) {
    // Setup must never replace a passphrase. The body is a throwaway; nothing is stored when it is refused.
    const res = await fetch(base + '/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: 'smoke-test-not-a-real-passphrase' }),
    });
    add(
      'first-run setup is closed once a passphrase exists',
      res.status === 409,
      `status ${res.status}`,
    );
  }

  // Sign-in is always required, so without a session no data is served (the smoke test never holds a passphrase).
  const overview = await get('/api/overview');
  add(
    'financial data is blocked without a session',
    overview.status === 401,
    `HTTP ${overview.status}`,
  );

  // Read-only: transactions, categories and reports are blocked without a session.
  const txns = await get('/api/transactions?limit=1');
  const cats = await get('/api/categories');
  const flow = await get('/api/reports/cash-flow');
  const spend = await get('/api/reports/categories?type=expense');
  add(
    'transactions and categories are blocked without a session',
    txns.status === 401 && cats.status === 401,
    `HTTP ${txns.status}/${cats.status}`,
  );
  add(
    'reports are blocked without a session',
    flow.status === 401 && spend.status === 401,
    `HTTP ${flow.status}/${spend.status}`,
  );

  const page = await get('/');
  const asset = /\/assets\/[^"']+\.js/.exec(page.text)?.[0];
  add(
    'web page is served',
    page.status === 200 && page.text.includes('id="root"'),
    `HTTP ${page.status}`,
  );
  add('page contains no balances', !/\$\d[\d,]*\.\d\d/.test(page.text), '');
  const deep = await get('/reports/category/1?type=expense');
  add(
    'page addresses (deep links) serve the app',
    deep.status === 200 && deep.text.includes('id="root"') && deep.text.includes('/assets/'),
    `HTTP ${deep.status}`,
  );
  add(
    'script bundle is served',
    !!asset && (await get(asset)).status === 200,
    asset || 'no script tag',
  );

  const unknown = await get('/api/definitely-not-a-route');
  add(
    'unknown API paths are rejected',
    [401, 404].includes(unknown.status),
    `HTTP ${unknown.status}`,
  );

  const spoof = await statusWithHost('/api/overview', 'evil.example');
  add('other host names are refused', spoof === 403, `HTTP ${spoof}`);
  const origin = await get('/api/overview', { Origin: 'https://example.com' });
  add('cross-site origins are refused', origin.status === 403, `HTTP ${origin.status}`);
} catch (e: any) {
  add('environment is reachable', false, e.cause?.code || e.message);
}

for (const c of checks)
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok || !c.detail ? '' : ` (${c.detail})`}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(
  failed ? `\n${failed} of ${checks.length} checks FAILED` : `\nAll ${checks.length} checks passed`,
);
process.exit(failed ? 1 : 0);
