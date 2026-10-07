export function configuration(env: NodeJS.ProcessEnv) {
  const appEnv = env.APP_ENV || 'staging';
  if (!['staging', 'production'].includes(appEnv))
    throw new Error('APP_ENV must be staging or production');
  const plaidEnv = env.PLAID_ENV || (appEnv === 'production' ? 'production' : 'sandbox');
  if (plaidEnv !== (appEnv === 'production' ? 'production' : 'sandbox'))
    throw new Error('APP_ENV and PLAID_ENV do not match');
  const origin = env.PUBLIC_ORIGIN || 'http://localhost:3002';
  const url = new URL(origin);
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('This deployment supports localhost only');
  const syncTimezone = env.SYNC_TIMEZONE || 'America/Los_Angeles';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: syncTimezone });
  } catch {
    throw new Error('SYNC_TIMEZONE must be an IANA time zone such as America/New_York');
  }
  const syncCron = env.SYNC_CRON || '0 13 * * *';
  if (syncCron.trim().split(/\s+/).length !== 5)
    throw new Error('SYNC_CRON must be a five-field cron expression such as 0 13 * * *');
  return {
    appEnv,
    plaidEnv: plaidEnv as 'sandbox' | 'production',
    production: appEnv === 'production',
    origin,
    hasKeys: !!env.PLAID_CLIENT_ID && !!env.PLAID_SECRET,
    redirectUri: env.PLAID_REDIRECT_URI || undefined,
    // Opt-in: also accept private-network addresses (e.g. http://192.168.1.20:3003).
    allowLan: env.ALLOW_LAN === 'true',
    // When the app sits behind a reverse proxy you run, trust its X-Forwarded-* headers (client address, https).
    trustProxy: env.TRUST_PROXY === 'true',
    // Daily sync schedule of the worker (default 1 PM Pacific).
    syncCron,
    syncTimezone,
    // Benchmarks and ticker prices come from Yahoo Finance's unofficial chart endpoint. MARKET_DATA=off never calls it.
    marketData: env.MARKET_DATA !== 'off',
    // Baked into the image at build time (see Dockerfile / deploy.sh).
    version: { commit: env.COMMIT_SHA || 'dev', builtAt: env.BUILT_AT || null },
  };
}
export const config = configuration(process.env);
export function assertTokenEnvironment(token: unknown, kind: 'public' | 'access') {
  if (typeof token !== 'string' || !token.startsWith(`${kind}-${config.plaidEnv}-`))
    throw new Error(`A ${config.plaidEnv} token is required`);
}
export function validateArchiveEnvironment(archive: any, production = config.production) {
  if (!production) return;
  if (archive.environment !== 'production')
    throw new Error('Production only accepts production archives');
  for (const table of Object.values(archive.tables || {}) as any[][]) {
    if (!Array.isArray(table)) throw new Error('Invalid archive table');
    if (
      table.some(
        (row) =>
          ['simulated', 'plaid_sandbox'].includes(row.source) ||
          ['simulated', 'plaid_sandbox'].includes(row.provenance),
      )
    )
      throw new Error('Test data cannot be imported into production');
  }
}
