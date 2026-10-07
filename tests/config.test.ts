import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, validateArchiveEnvironment } from '../server/lib/config.ts';
test('environment pairing fails closed', () => {
  assert.equal(configuration({}).plaidEnv, 'sandbox');
  assert.equal(configuration({ APP_ENV: 'production', PLAID_ENV: 'production' }).production, true);
  assert.throws(() => configuration({ APP_ENV: 'staging', PLAID_ENV: 'production' }));
  assert.throws(() => configuration({ APP_ENV: 'production', PLAID_ENV: 'sandbox' }));
  assert.throws(() => configuration({ APP_ENV: 'unexpected' }));
});
test('production archive imports reject test data even when mislabeled', () => {
  assert.throws(() => validateArchiveEnvironment({ environment: 'sandbox', tables: {} }, true));
  assert.throws(() =>
    validateArchiveEnvironment(
      { environment: 'production', tables: { accounts: [{ source: 'simulated' }] } },
      true,
    ),
  );
  assert.throws(() =>
    validateArchiveEnvironment(
      {
        environment: 'production',
        tables: { balance_snapshots: [{ provenance: 'plaid_sandbox' }] },
      },
      true,
    ),
  );
  assert.doesNotThrow(() =>
    validateArchiveEnvironment(
      { environment: 'production', tables: { accounts: [{ source: 'manual' }] } },
      true,
    ),
  );
});

test('sync schedule, market data and proxy trust are configurable, with the old behaviour as default', () => {
  const d = configuration({});
  assert.equal(d.syncCron, '0 13 * * *');
  assert.equal(d.syncTimezone, 'America/Los_Angeles');
  assert.equal(d.marketData, true);
  assert.equal(d.trustProxy, false);
  const c = configuration({
    SYNC_CRON: '30 6 * * *',
    SYNC_TIMEZONE: 'Europe/Berlin',
    MARKET_DATA: 'off',
    TRUST_PROXY: 'true',
  });
  assert.deepEqual(
    [c.syncCron, c.syncTimezone, c.marketData, c.trustProxy],
    ['30 6 * * *', 'Europe/Berlin', false, true],
  );
  assert.throws(() => configuration({ SYNC_TIMEZONE: 'Mars/Base' }), /IANA/);
  assert.throws(() => configuration({ SYNC_CRON: 'daily' }), /five-field/);
});
