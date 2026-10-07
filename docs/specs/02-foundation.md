# 02 · Foundation

Part of the [specification](README.md). Read [00 · Principles](00-principles.md) first. After this spec you have an
empty but complete skeleton: it builds, starts, migrates its database, refuses strangers, serves a page, and can be
deployed and smoke-tested. Every later feature adds routes, tables and pages to it.

## Deliverables

1. **Project.** Node 22, TypeScript (ES modules, `tsx` runs the server), Vite + React 19 + Tailwind v4 for the UI.
   `package.json` scripts: `dev`, `build` (`tsc --noEmit && vite build`), `start` (`tsx server/index.ts`), `worker`
   (`tsx server/worker.ts`), `test`, `test:ui` (vitest), `test:integration`, `format`/`format:check` (prettier),
   `lint` (eslint), `typecheck`, and `check` = format check + lint + typecheck + all tests.
   Dependencies the rest of the spec assumes: `fastify`, `@fastify/static`, `pg`, `pg-boss`, `plaid`, `zod`,
   `decimal.js`, `recharts`, `react-plaid-link`, `lucide-react`, `tailwind-merge`, `class-variance-authority`, `clsx`.
2. **Git hooks.** A pre-commit hook runs `npm run check`; no commits or pushes on `main` (see
   [CONTRIBUTING.md](../../CONTRIBUTING.md)).
3. **Configuration** (`server/lib/config.ts`, one pure function `configuration(env)` plus `config = configuration(process.env)`):

   | Variable                           | Default                             | Rule                                                                                |
   | ---------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
   | `APP_ENV`                          | `staging`                           | `staging` or `production`; anything else throws                                     |
   | `PLAID_ENV`                        | `sandbox` / `production`            | must match `APP_ENV` (staging = sandbox, production = production) or startup throws |
   | `PUBLIC_ORIGIN`                    | `http://localhost:3002`             | hostname must be `localhost` or `127.0.0.1`                                         |
   | `PLAID_CLIENT_ID`, `PLAID_SECRET`  | empty                               | `hasKeys` is true only when both are set                                            |
   | `PLAID_REDIRECT_URI`               | none                                | passed to Link when set                                                             |
   | `ALLOW_LAN`                        | `false`                             | `true` also accepts private-network hosts and makes sign-in mandatory               |
   | `TRUST_PROXY`                      | `false`                             | `true` only behind a proxy you run: use `X-Forwarded-*`                             |
   | `SYNC_CRON`, `SYNC_TIMEZONE`       | `0 13 * * *`, `America/Los_Angeles` | five fields; an IANA zone, both validated at startup                                |
   | `MARKET_DATA`                      | on                                  | `off` never contacts Yahoo Finance                                                  |
   | `COMMIT_SHA`, `BUILT_AT`           | `dev`, none                         | baked into the image; shown in the footer and `/api/health`                         |
   | `DATABASE_URL`, `PORT`, `KEY_FILE` | —                                   | database, listen port (3002), path of the token key (`secrets/token.key`)           |

   `assertTokenEnvironment(token, kind)` rejects a Plaid token whose prefix is not `<kind>-<plaidEnv>-`.
   `validateArchiveEnvironment` makes production refuse any archive that is not `environment: 'production'` or that
   holds a row whose `source` or `provenance` is `simulated` or `plaid_sandbox`.

4. **Processes.** Three: `app` (Fastify), `worker` (pg-boss scheduler, see [03](03-connections-and-sync.md)) and
   `db` (PostgreSQL 17). Both Node processes run `migrate()` on start; the worker waits for a healthy app.
5. **Docker.** A two-stage `Dockerfile` (build with all dependencies and `npm run build`; runtime with production
   dependencies, `server/`, `dist/`, running as the unprivileged `node` user, `EXPOSE 3002`, `CMD npm start`).
   Compose files per environment (staging, production, and `lan` overrides) with the `db`, `app` and `worker`
   services, a health check on `/api/health`, the token key mounted as a Docker secret, and the app bound to
   `127.0.0.1` only. Staging listens on 3002, production on 3003; they run side by side with separate databases,
   keys and volumes. `INSTANCE_NAME` (default `moneyrill`) names the Compose projects (`<name>-staging`, `<name>-production`), their volumes
   and the database user and name; `deploy.sh` refuses to start one under a new name when the computer already has
   another installation's database volume, because a changed name would point it at an empty database. The scripts that drive them are in
   [`development/OPERATIONS.md`](../development/OPERATIONS.md) ([10 · Operations](10-operations-and-release.md)).

## Start-up sequence (`server/index.ts`)

1. Check the token key and log (never throw) a problem in words that say what to do (`tokenKeyProblem`): manual
   accounts and reports do not need the key.
2. `migrate()`.
3. Seed demo data (staging only; skipped in production): `seed()`, `seedTransactions()`, `seedReportHistory()`.
4. `remapAutoCategories()` (see [06 · Transactions](06-transactions-and-categories.md)).
5. Build the Fastify app and listen on `0.0.0.0:PORT` inside the container (the host binding is the Compose port map).
6. On `SIGTERM` close the app and the pool.

## The HTTP shell (`server/app.ts`)

- Fastify with `bodyLimit` 12 MB and `trustProxy` from config. Routes are registered in one function per area
  (`authRoutes`, `overviewRoutes`, `syncRoutes`, `linkRoutes`, `accountRoutes`, `archiveRoutes`,
  `transactionRoutes`, `reportRoutes`, `investmentRoutes`), then `@fastify/static` serves `dist/`, and any non-`/api`
  path that is not a file answers `index.html` (so every page has an address). An unknown `/api` path answers 404
  `{error: "Unknown endpoint"}`.
- **Every response** carries a Content-Security-Policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a `Permissions-Policy` denying camera, microphone and geolocation, and
  `Cross-Origin-Opener-Policy: same-origin`. The policy is `default-src 'self'`; scripts from `'self'`,
  `https://cdn.plaid.com` and the SHA-256 hash of each inline script in the built `index.html` (computed at start,
  so editing the theme script needs no policy change); styles `'self' 'unsafe-inline'`; images `'self' data: https:`;
  fonts `'self' data:`; `connect-src 'self' https://*.plaid.com`; `frame-src https://cdn.plaid.com`;
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
- **Every `/api` request** gets `Cache-Control: no-store` and three checks, each answering 403 with
  `{error}`: the `Host` must be allowed (`localhost` or `127.0.0.1`, plus private-network hosts only with
  `ALLOW_LAN`: `10.x`, `172.16-31.x`, `192.168.x` and `*.local`); an `Origin`, when present, must be the configured
  origin (or its `127.0.0.1` twin, or, in LAN mode, `http://<the Host the request came to>`); and `Sec-Fetch-Site`
  must not be `cross-site`.
- **Errors.** One handler turns any thrown error into `{error: <Plaid error_code or the message>}` with the error's
  status code (default 400) and logs only the method, the route without its query string and the code.
- `GET /api/health` answers `{ok: true, mode: <plaidEnv>, version: {commit, builtAt}}` and is open without a session.
- Request bodies are validated with the zod schemas in `server/lib/schemas.ts` via `ensure(schema, body, message)`,
  which throws `message` when invalid.

## Database

- `pg` pool in `server/db/pool.ts` from `DATABASE_URL`.
- **Migrations** (`server/db/migrate.ts`): numbered files `NNN_name.sql` in `server/db/migrations/`, ordered by name.
  In one transaction holding advisory lock `931879`: create `schema_migrations(version, checksum, applied_at)`; for each
  file, skip it if applied with an identical checksum, **throw** if applied with a different checksum ("was changed
  after it was applied; add a new one"), otherwise run it and record it. Then verify the environment (below).
- **Environment identity.** The `settings` row `environment` holds `sandbox` or `production`. Startup throws if the
  saved value differs from `PLAID_ENV`, if any `connections.environment` differs, or if production finds accounts whose
  `source` is `simulated` or `plaid_sandbox`. First run stores the value.
- **Baseline schema** (`001_baseline.sql`), every table additive and keyed so a repeat never duplicates:
  - `connections(id, institution, token, products jsonb, environment, created_at)`; later `disconnected_at`,
    `last_synced`, `last_error`, `consent_expires_at`.
  - `accounts(id, connection_id, provider_id, name, institution, kind, currency, mask, included, source, last_synced,
last_error)`, unique `(connection_id, provider_id)`; `kind` is `investment`, `cash`, `credit` or `loan`;
    later `provider_as_of`, `holdings_as_of`.
  - `balance_snapshots(account_id, date, current_balance numeric(24,8), provenance, observed_at)`, unique
    `(account_id, date)`, plus `balance_observations`, filled by a trigger on every insert or update so no
    observation is lost.
  - `securities`, `holding_snapshots`, `benchmark_observations`, `daily_net_worth`, `sync_runs`, `settings(key, value jsonb)`.
- Later migrations (`002_sessions` … `013_holdings_adjustment`) are described in the spec that owns the feature.
- **Seed** (`server/db/seed.ts`): staging only, once (guarded by `settings.seeded` under advisory lock `931875`):
  six simulated accounts (brokerage, Roth IRA, checking, savings, two cards), securities, a deterministic simulated
  history, simulated transactions and report history, all with `source`/`provenance` `simulated`, then `recompute`.

## Sign-in

- **One passphrase**, at least 12 characters, normalized NFKC, stored as scrypt (`N=2^15, r=8, p=1`, 64-byte key,
  random 16-byte salt) in `settings.auth_passphrase`. Set or cleared only on the host with
  `./scripts/set-passphrase.sh <staging|production> [--clear]` (typed hidden, never an argument or a file); changing or
  clearing it deletes every session.
- **Sessions.** A random 32-byte token (base64url) in the cookie `sw_session` (`HttpOnly`, `SameSite=Strict`, `Path=/`,
  30 days, `Secure` when `X-Forwarded-Proto` is https). Only the SHA-256 of the token is stored in
  `sessions(token_hash, created_at, expires_at)`; expired rows are deleted whenever one is created.
- **When sign-in is required:** when a passphrase exists, or always when `ALLOW_LAN` is on (before one exists the
  login page says how to set it). Otherwise the app is open on localhost.
- **Endpoints:** `GET /api/auth/status` → `{required, configured, authenticated}`; `POST /api/auth/login`
  `{passphrase}` → sets the cookie; `POST /api/auth/logout` clears it. These and `/api/health` are open; everything
  else under `/api` answers 401 `{error}` without a session when sign-in is required.
- **Brute force.** Failed attempts are counted per client address (`req.ip`); the fifth failure locks that address
  for 15 minutes (429, "Too many attempts. Try again in N minutes."); every failure waits 400 ms; at most 1,000
  addresses are tracked, oldest forgotten first; a success clears the address. A wrong passphrase answers 401
  "Incorrect passphrase"; no passphrase set answers 503.

## The page shell

- `index.html` has the inline script that sets `data-theme` from the saved choice before first paint (so there is no
  flash) and sets the browser `theme-color`.
- Footer and sign-in page show `v <commit> · built <time>`; staging also shows an amber top strip, a `STAGING` badge
  and tab title; production shows none of these.
- Routing, the top bar and the pages are added by [08](08-home-and-headings.md) and [09](09-settings-navigation-and-private-mode.md).

## Acceptance checks

- `npm run check` passes from a clean clone after `npm ci`.
- `configuration()` throws for: an unknown `APP_ENV`, `APP_ENV`/`PLAID_ENV` mismatch, a non-local `PUBLIC_ORIGIN`, a
  bad `SYNC_TIMEZONE`, a `SYNC_CRON` without five fields (`tests/config.test.ts`).
- Host and origin rules: a foreign `Host` or `Origin` and `Sec-Fetch-Site: cross-site` are refused with 403; LAN hosts
  are accepted only with `ALLOW_LAN` (`tests/hosts.test.ts`, `tests/app.test.ts`).
- The CSP contains the hash of every inline script in the built page and nothing from other hosts but Plaid
  (`tests/app.test.ts`).
- Migrations: a changed applied file is refused; a repeat run applies nothing; an environment mismatch refuses to
  start (`tests/migrations*.ts`).
- Sign-in: wrong passphrase 401 after the delay; five failures lock one address but not another; success sets a
  `HttpOnly` `SameSite=Strict` cookie; changing the passphrase invalidates sessions; with `ALLOW_LAN` and no
  passphrase everything but the open endpoints answers 401 (`tests/auth.test.ts`).
- Against a running stack (`tests/smoke.ts URL MODE [COMMIT]`): health answers and reports the mode and commit, auth
  status is sane, data endpoints are blocked without a session, the page and bundle are served, a foreign Host and
  Origin are refused.
- Production starts with the demo seed skipped and refuses a staging database.
