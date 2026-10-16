# Running Moneyrill

Environments, configuration, sign-in, backups and releases. For an overview and the quick start, see the [README](../../README.md).

**Installation name.** `INSTANCE_NAME` in `.env` and `.env.production` (default `moneyrill`) names the Docker Compose projects (`<name>-staging`, `<name>-production`), their database volumes, the PostgreSQL user and database, and the backup job's launchd label (`com.<name>.backup`). Choose it once: changing it later points the installation at a new, empty database (the old one stays in its volume), so `deploy.sh` refuses when the computer already has a database volume under another name.

## Separate environments

|                 | Staging                                              | Production                                 |
| --------------- | ---------------------------------------------------- | ------------------------------------------ |
| URL             | http://localhost:3002 (`STAGING_PORT`)               | http://localhost:3003 (`PRODUCTION_PORT`)  |
| Compose project | `<name>-staging` (moneyrill-staging)                 | `<name>-production`                        |
| Configuration   | .env                                                 | .env.production                            |
| Plaid           | Sandbox                                              | Production                                 |
| Encryption key  | secrets/token.key                                    | secrets/production.key                     |
| Database volume | `<name>-staging_database`                            | `<name>-production_database`               |
| Initial data    | Simulated history, optional fake Sandbox connections | Empty; real connected/manual accounts only |

Both may run simultaneously, each on its own port: `STAGING_PORT` (default 3002) and `PRODUCTION_PORT` (default 3003). Set either in `.env`, or in `.env.production` to override it; `deploy.sh` refuses the same port for both, and the app inside the container always listens on 3002. Production has a single account view with no dataset dropdown or sample generator. Staging lets you choose demo history or connected/manual test accounts. Production has no synthetic benchmarks; it compares against real S&P 500 (SPY) and Nasdaq-100 (QQQ) history.

A database stores its environment identity. Pointing a production app at a staging database (or vice versa) fails before startup. Production rejects Sandbox tokens, sample-generation requests and staging archives, including mislabeled archives containing simulated records. No environment copies data into the other. The database port is not exposed; the app is bound to loopback for a local single-user deployment.

## First setup

```sh
./scripts/setup.sh staging
# Optional: put Sandbox PLAID_CLIENT_ID and PLAID_SECRET in .env.
./scripts/deploy.sh staging
```

For production:

```sh
./scripts/setup.sh production
# Put Production PLAID_CLIENT_ID and PLAID_SECRET in .env.production.
```

Setup generates a separate database password and key without replacing existing files. Preserve the password/key when reusing the database volume. Never put Production credentials in `.env` or commit credentials. `.env.example` and `.env.production.example` are the safe templates.

## Run the published image

Each release tag (`v0.1.0`) publishes an image to `ghcr.io/xingyu-long/moneyrill` (tags `0.1.0` and `0.1`). To try Moneyrill without cloning the source, use [`examples/compose.image.yaml`](../../examples/compose.image.yaml): it starts the app, the worker and PostgreSQL from that image with the demo setup (simulated data, Plaid Sandbox, loopback only).

```sh
mkdir moneyrill && cd moneyrill
curl -O https://raw.githubusercontent.com/xingyu-long/moneyrill/main/examples/compose.image.yaml
openssl rand -hex 32 > token.key && chmod 600 token.key       # keep it: it encrypts the bank tokens
MONEYRILL_VERSION=0.1.0 docker compose -f compose.image.yaml up -d
open http://localhost:3002                                    # Linux: xdg-open
```

Pin the version you tested; to upgrade, set a newer `MONEYRILL_VERSION` and run `up -d` again (migrations are additive and run on start; take a backup first). Sandbox keys go in `PLAID_CLIENT_ID` and `PLAID_SECRET` in the environment or a `.env` file next to the compose file. `docker compose -f compose.image.yaml down` stops it; add `-v` to delete the data.

### With real accounts

[`examples/compose.image.production.yaml`](../../examples/compose.image.production.yaml) is the same stack for real data: production mode, Plaid Production, a required database password and its own key, on http://localhost:3003 (loopback only). Use a separate folder, and never reuse the demo's volume.

```sh
mkdir moneyrill-production && cd moneyrill-production
curl -O https://raw.githubusercontent.com/xingyu-long/moneyrill/main/examples/compose.image.production.yaml
openssl rand -hex 32 > production.key && chmod 600 production.key
umask 077 && cat > .env.production <<ENV
PLAID_CLIENT_ID=<your Production client id>
PLAID_SECRET=<your Production secret>
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ENV
MONEYRILL_VERSION=0.1.0 docker compose --env-file .env.production -f compose.image.production.yaml up -d
```

Then open http://localhost:3003 and **create the sign-in passphrase right away** (see [Sign-in](#sign-in-passphrase)): until one exists, whoever opens the page first can choose it.

Keep `.env.production` and `production.key` private and back them up with your database: the key decrypts the bank tokens, and the password belongs to the existing volume. Every later `docker compose` command needs the same `--env-file .env.production`. This setup has no staging step, backup job, migration rehearsal or rollback: before upgrading, take a backup (`docker compose ... exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup.dump`, then encrypt and store it), and keep the previous `MONEYRILL_VERSION` to go back. For those safeguards, run from the source checkout as described above. Do not create real Plaid connections just to test; Plaid's free trial allows only a few.

### Moving to another computer (for example a NAS)

Move the data with an encrypted backup, and start the stack empty before restoring into it. You need three things from the old computer: the newest `backups/encrypted/production-*.dump.enc`, `secrets/backup.key` (decrypts the backup) and `secrets/production.key` (decrypts the bank tokens inside it). Carry the files over a private channel (`scp`, a USB drive), keep the two keys apart from the backup, and delete the copies you no longer need.

1. **Old computer:** `./scripts/backup.sh production` (verified and encrypted), then copy the files above plus `.env.production` for the Plaid keys.
2. **New computer, in a new folder:** put `production.key` (the old `production.key`), `backup.key`, the backup and the example compose file there. Write `.env.production` with the Plaid keys, a **new** `POSTGRES_PASSWORD` (`openssl rand -hex 24`) and the `INSTANCE_NAME` you want (any name; the restore ignores owners). To reach it from your other devices add `BIND_ADDRESS=<its private LAN address>` and `ALLOW_LAN=true` (never `0.0.0.0`). The passphrase comes across with the data, so you sign in with the old one.
3. **Start only the database:** `MONEYRILL_VERSION=… docker compose --env-file .env.production -f compose.image.production.yaml up -d db`
4. **Restore into it** (the app has not run, so the database is empty):
   ```sh
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:backup.key -in production-YYYYMMDD-HHMMSS.dump.enc |
     MONEYRILL_VERSION=… docker compose --env-file .env.production -f compose.image.production.yaml exec -T db \
       sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner'
   ```
5. **Start everything:** `… up -d`. Use an image version at least as new as the one that made the backup; migrations run on start. Check that the accounts and balances match the old computer before you retire it.
6. **Plaid:** existing connections keep syncing (their tokens travel in the backup, encrypted with `production.key`). Plaid Link needs HTTPS or `localhost`, so to connect or reconnect an account open the app at `localhost` on the machine that runs it, or from a computer you reach it through with an SSH port forward you start yourself. Do not expose it to the internet.

Stop the old stack (`docker compose -p <name>-production down`, never `-v`) before you run both on the same network, and keep its volume and the backup until the new one has run a few days and been backed up itself.

### Moving an existing source installation to the image

The data stays in its Docker volume, so switching only changes what runs on it. Use the same `INSTANCE_NAME`, database password and key, and the example will reuse the volume `<name>-production_database`.

1. Back up first (`./scripts/backup.sh production`) and keep the backup.
2. In a new folder, copy `.env.production` (it holds `INSTANCE_NAME`, `POSTGRES_PASSWORD` and the Plaid keys) and `secrets/production.key` (as `production.key`) from the checkout, and download the example.
3. Stop the old stack without deleting data: `docker compose -p <name>-production down` (never `-v`).
4. Start the image: `MONEYRILL_VERSION=… docker compose --env-file .env.production -f compose.image.production.yaml up -d`. Migrations run on start; the passphrase and all data are unchanged.
5. To go back, stop it the same way and run `./scripts/deploy.sh production IMAGE` from the checkout with the image it recorded.

After the switch the checkout's `deploy.sh`, `ship.sh --promote-only`, `rollback.sh` and the daily backup job no longer match what is running, so back up with `pg_dump` as above, or keep deploying production from the source checkout instead.

## Which version is running?

Each image carries the git commit and build time it was made from (set by `deploy.sh` through Docker build arguments). They show in the footer (`v c4ad6c8 · built Oct 3, 5:34 PM`), on the sign-in page, and in `GET /api/health` (`version.commit`). `ship.sh` checks that each environment reports the commit it just deployed. Staging has an amber top strip, badge and a `STAGING` tab title; production is green.

## Reaching the app from another device (same Wi-Fi)

Off by default. Add to `.env.production` (or `.env` for staging), then redeploy:

```sh
BIND_ADDRESS=192.168.1.20   # this computer's Wi-Fi address (not 0.0.0.0)
ALLOW_LAN=true
```

Open `http://<this-computer's-LAN-IP>:3003` (your `PRODUCTION_PORT`) (find it with `ipconfig getifaddr $(route -n get default | awk '/interface:/{print $2}')`). Only private-network addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x, `*.local`) are accepted. Sign-in is always required, so nothing under `/api` answers without a session, and until a passphrase exists the sign-in page offers to create one. Plaid Link needs HTTPS, so connect or reconnect accounts from the host computer at `http://localhost:3003`. `deploy.sh` refuses any `BIND_ADDRESS` that is not loopback or a private address, and the app itself rejects other Host headers, so it is never published to the internet; do not port-forward it on your router. If your router gives this computer a new address, update `BIND_ADDRESS` (a DHCP reservation avoids that). Remove the two lines and redeploy to turn it off.

## Sign-in (passphrase)

One passphrase for one person, no accounts, and no scripts: everything is in the browser.

- **First run.** Staging and production each start with no passphrase: opening the app shows **Create a passphrase** (12+ characters, typed twice) and signs you in. **Create it right after the first deploy**: until one exists, whoever opens the page first (on your Wi-Fi too, with `ALLOW_LAN`) can choose it. Once a passphrase exists, setup is closed and the page only ever asks for it. Staging and production have separate passphrases.
- **Change it** in **Settings → Sign-in**: current passphrase, new one, repeat. Every other device is signed out; you stay signed in.
- **Forgot it?** The browser cannot recover it. On the computer running the app, delete the stored passphrase and every session (use `staging` for staging), then reload: the page offers **Create a passphrase** again.

```sh
docker exec -i <instance>-production-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DELETE FROM settings WHERE key = 'auth_passphrase';
DELETE FROM sessions;
SQL
```

`<instance>` is `INSTANCE_NAME` from `.env.production` (`moneyrill` unless you set it). Until a new passphrase is created in the browser, nothing is accessible.

- Stored as a salted scrypt hash; the browser gets a random session token in an `HttpOnly`, `SameSite=Strict` cookie (30 days). Only a hash of the token is kept in the database.
- Five wrong attempts (sign-in, or a wrong current passphrase when changing it) from the same address lock sign-in from that address for 15 minutes; other addresses are not affected (restart the app container to clear it). Behind a reverse proxy set `TRUST_PROXY=true` so each client counts separately.
- Changing the passphrase signs every other device out. **Sign out** is in the top bar.
- Every response carries a Content-Security-Policy (scripts only from the app itself, one hashed inline script and Plaid Link), `X-Frame-Options: DENY`, `nosniff` and no referrer. The container runs as an unprivileged user.
- Over plain `http://` on Wi-Fi the passphrase is not encrypted in transit, so treat the network as trusted. HTTPS (Tailscale `serve` or a local certificate) is in TODO.md.

## Backups and database access

```sh
./scripts/backup.sh production        # encrypted, verified, keeps newest 14 (BACKUP_KEEP)
./scripts/restore-check.sh production # restores newest backup into a throwaway DB and compares counts
./scripts/install-daily-backup.sh     # macOS launchd job, daily 02:30 (see note below)
```

Backups are AES-256 encrypted with `secrets/backup.key` and stored in `backups/encrypted/`. Each one is decrypted and checked as a valid PostgreSQL archive before it is kept. Keep copies of `secrets/backup.key` and `secrets/production.key` in a separate secure place; neither is in the database backup.

**Linux:** `install-daily-backup.sh` is macOS-only (launchd). Use cron instead, for example `30 2 * * * cd /path/to/moneyrill && ./scripts/backup.sh production >> backups/backup.log 2>&1`. A key file mounted into the container must be readable by uid 1000 (the `node` user): `chmod 644 secrets/*.key` is acceptable on a single-user machine, or `chown 1000 secrets/*.key`.

**macOS note:** launchd cannot read project files under `~/Documents` or `~/Desktop` without Full Disk Access (the job exits with "Operation not permitted"). Either grant it to `/bin/sh`, or keep the project outside those folders, then run `launchctl kickstart gui/$(id -u)/com.<name>.backup` and check `backups/backup.log`.

Back up the matching token key and configuration separately. A database backup alone cannot decrypt connections. Backup files and exported financial archives are not encrypted automatically. Normal `docker compose down` preserves volumes; do not use `down -v` on data you want to keep.

Open PostgreSQL:

```sh
# Staging
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
# Production
APP_IMAGE="$(cat .releases/production-image)" docker compose --env-file .env.production -f compose.production.yaml exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Inside psql: `\dt` lists tables, `\d accounts` shows columns, `\q` exits. To inspect a backup safely, use `createdb` and `pg_restore --no-owner` into a separate database, verify it, then deliberately change DATABASE_URL to that database. Keep the original until recovery is verified.

Settings offers a portable versioned JSON archive and account CSV; Investments exports holdings CSV. Archives exclude connection credentials. Re-imports are deduplicated by source IDs/dates. Generic bank/Monarch CSV mapping is not included.

## Migration rehearsal

`./scripts/deploy.sh production IMAGE` first runs `./scripts/rehearse-migrations.sh IMAGE`: it takes a fresh encrypted backup, restores it into a throwaway database, applies the image's pending migrations there, and checks that every table keeps its row count, the overview still loads and the latest net worth is reproduced. Production itself is only read. If anything fails, the deploy stops.

```sh
./scripts/rehearse-migrations.sh                          # candidate = the image on staging
./scripts/rehearse-migrations.sh IMAGE --migrations DIR   # try a migrations folder before building an image
SKIP_REHEARSAL=1 ./scripts/deploy.sh production IMAGE     # emergency only: backup, no rehearsal
```

A migration that intentionally changes row counts (for example a cleanup) will fail the rehearsal on purpose; review it, and if it is correct update `tests/rehearsal-check.ts` for that release.

## Workflow: branch → pull request → release

All changes go through a branch and a pull request; `main` only receives merged pull requests that passed the local gate (and CI), and production only runs what was merged. The full steps are in [CONTRIBUTING.md](../../CONTRIBUTING.md):

```sh
./scripts/branch.sh name              # start from the latest main
./scripts/ship.sh --stage-only        # try it on staging (works on a pushed branch)
./scripts/pr.sh "Title"               # push + open the pull request
./scripts/merge-pr.sh 12              # squash-merge a commit that passed ship.sh --stage-only (--wait: wait for CI), back to updated main
./scripts/ship.sh --stage-only        # on main: stage what was merged
./scripts/ship.sh --promote-only      # release to production (you type "promote")
```

Hooks enforce it locally (no commits or pushes on `main`); GitHub branch protection enforces it remotely when the plan allows (`python3 scripts/gh.py protection`).

## Releasing: `./scripts/ship.sh`

```sh
./scripts/ship.sh                 # checks -> staging -> smoke test -> asks -> production -> smoke test
./scripts/ship.sh --stage-only    # stop at staging so you can try it at http://localhost:3002
./scripts/ship.sh --promote-only  # then promote exactly what you tried
./scripts/ship.sh --yes           # skip the confirmation (automation)
```

It stops at the first failure and never touches production before staging passed:

1. The working tree must be clean. Production releases come from `main` with nothing that skipped a pull request; on a pushed feature branch only `--stage-only` is allowed.
2. `npm run check` (format, lint, types, unit and UI tests).
3. Deploys that commit to staging as a tagged image, then smoke-tests it (`tests/smoke.ts`: health and mode, sign-in status, data blocked without a session, web page and bundle served, foreign Host and Origin refused).
4. Shows what will change in production (commits since the running version, new database migrations) and asks you to type `promote`; anything else cancels without touching production.
5. `deploy.sh production`: backup, migration rehearsal on a copy of real data, then the same image.
6. Smoke-tests production. If it fails you are told to run `./scripts/rollback.sh`.

Every step is logged in `.releases/history.log`. The individual commands (`deploy.sh staging`, `deploy.sh production IMAGE`) still work. `tests/smoke.ts` can also be run alone: `npx tsx tests/smoke.ts http://localhost:3003 production`.
