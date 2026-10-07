# 10 · Operations and release

Part of the [specification](README.md). Read [00 · Principles](00-principles.md) and [02 · Foundation](02-foundation.md)
first. This spec pins **what the delivery process guarantees**: environments, the scripts and the order they run in, the
gates a change passes, backups, rollback and the safety refusals. The day-to-day commands, flags and platform notes are in
[`development/OPERATIONS.md`](../development/OPERATIONS.md) and [`development/DEVELOPMENT.md`](../development/DEVELOPMENT.md);
the workflow rules for people and agents are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and [`CLAUDE.md`](../../CLAUDE.md).
A rebuild reproduces the guarantees below with scripts of its own choosing.

## Environments

Two Compose projects on one computer, **never sharing a database, key, volume or identifier namespace**
([00](00-principles.md#database)):

|               | Staging                                            | Production                                         |
| ------------- | -------------------------------------------------- | -------------------------------------------------- |
| URL           | `http://localhost:3002`                            | `http://localhost:3003`                            |
| Configuration | `.env` (from `.env.example`)                       | `.env.production` (from `.env.production.example`) |
| Plaid         | Sandbox (fake banks)                               | Production (the owner's own keys)                  |
| Token key     | `secrets/token.key`                                | `secrets/production.key`                           |
| Data          | fake data plus Sandbox only; seeded on first start | real data only; never seeded; empty at first       |
| Sign-in       | always required; its own passphrase                | always required; its own passphrase                |

- Both may run at once. Staging shows an amber strip, `STAGING` badge and tab title; production shows none
  ([02](02-foundation.md#the-page-shell)).
- A database stores its environment identity; pointing an app at the other environment's database fails before start-up, and
  production rejects sandbox tokens, sample generation and archives containing simulated records
  ([02](02-foundation.md#database)). **No environment copies data into the other.** Production data is never copied into staging.
- **Network exposure.** The app listens only on `127.0.0.1` and, with `BIND_ADDRESS` + `ALLOW_LAN=true`, one private address
  (`10.x`, `172.16-31.x`, `192.168.x`); `deploy.sh` **refuses any other bind address** (never `0.0.0.0`, never a tunnel or port
  forward), and sign-in is always required. The database port is never published.

## Setup (`scripts/setup.sh [staging|production]`)

Idempotent and never replaces an existing file: creates `.env` / `.env.production` from the templates, a random 64-hex-character
token key (`openssl rand -hex 32`, mode 600) and, for production, a separate database password. Secrets live in `secrets/`
(never committed). The sign-in passphrase has no script: it is created on the sign-in page and changed in Settings → Sign-in ([02](02-foundation.md#sign-in)).

## The release path

```
branch -> change + tests -> npm run check -> push -> ship.sh --stage-only -> pull request -> (owner approves) -> merge
       -> on main: ship.sh --stage-only -> (owner asks) -> ship.sh --promote-only --yes
```

**Rules that make it safe** (enforced by hooks and scripts, stated in `CLAUDE.md` for agents):

1. **Nothing is committed or pushed on `main`** (a `pre-commit` hook, bypassable only with `ALLOW_MAIN_COMMIT=1`, and a `pre-push`
   hook; GitHub branch protection where the plan allows, checked with `python3 scripts/gh.py protection`). `./scripts/branch.sh
name` starts `feature/name` from the latest `origin/main`; `./scripts/pr.sh "Title"` pushes and opens the pull request.
2. **A pre-commit hook runs `npm run check`** (format, lint, typecheck, server and UI tests); skipping it is an emergency measure.
3. **`./scripts/ship.sh --stage-only`** is the local gate, and stops at the first failure: (1) the working tree is clean and
   pushed (on `main`: no commits that skipped a pull request, not behind `origin`; on a feature branch only `--stage-only`
   is allowed); (2) `npm run check`; (2b) `scripts/integration.sh`, the migrations on an empty database and the API integration
   test on a disposable PostgreSQL in Docker named `moneyrill-itest-*` (ports 55432 and 3099, loopback only, never touching staging
   or production); (3) build and deploy the image to staging, running the unit tests **inside the build stage** and refusing an image
   that ran no tests; (4) the smoke test ([02](02-foundation.md#acceptance-checks)) against staging, which must report this commit.
   On success it records `VERIFIED <commit>` in `.releases/history.log`: **the gate is per commit**; a new push needs a new stage.
4. **A pull request is opened, then the owner approves the merge.** `./scripts/merge-pr.sh N` squash-merges a commit that has
   `VERIFIED` without waiting for a GitHub runner, never one whose CI has failed (`--wait` waits for green CI), then returns to an
   updated `main`. A request to build something is **not** approval to merge, and approval of one pull request does not cover the next.
5. **CI** (`.github/workflows/ci.yml`; push to `main` and every pull request; a newer push to a pull request cancels its older
   run; 10-minute timeout): checkout, Node 22, `npm ci`, `npm run check`, `npm run build`, migrations on an empty PostgreSQL 17,
   the API integration test against a started server. **It never receives Plaid credentials.**
6. **Promotion is only on the owner's explicit word** ("promote", "ship it"): on `main`, `ship.sh --stage-only` again, then
   `ship.sh --promote-only` shows what will change (the commits since the running version, the new migrations), reads CI for the
   commit (a failed CI blocks; a running one is only a notice) and asks for the exact word `promote` (`--yes` skips the question
   for automation; anything else, or no terminal, declines). `deploy.sh production IMAGE` **never rebuilds**: the image must be
   the staging image that was validated (compared by image id), it takes a **backup and runs the migration rehearsal** first
   (below), keeps the previous image for rollback, and starts the new one. Then production is smoke-tested; on failure the
   output says to run `./scripts/rollback.sh`. Every step is logged in `.releases/history.log` (`STAGED`, `VERIFIED`, `DECLINED`,
   `RELEASED`, `PRODUCTION SMOKE FAILED`, `STOPPED …`).
7. After a release, say plainly what changed, what was verified and what could not be.

Never done on an agent's own initiative: production deploys, rollbacks, restores, changes to `.env.production`, skipping hooks
or the rehearsal (`SKIP_REHEARSAL=1`), or merging without approval.

## Migration rehearsal (`scripts/rehearse-migrations.sh [IMAGE] [--migrations DIR]`)

Takes a fresh encrypted backup, restores it into a **throwaway database**, applies the candidate image's pending migrations
there and checks: every table keeps its row count, the overview endpoint still loads and the latest net worth is reproduced
(`tests/rehearsal-check.ts`). Production is only read (`pg_dump`). If anything fails the deploy stops. A migration that
intentionally changes row counts fails the rehearsal on purpose and must update the check for that release. Migrations are
additive and backward compatible so an image rollback stays safe ([02](02-foundation.md#database)).

## Backups and restore

- `scripts/backup.sh [production|staging]`: a PostgreSQL archive, **AES-256 encrypted with `secrets/backup.key`**, written to
  `backups/encrypted/`, **decrypted and verified as a valid archive before it is kept**, newest 14 kept (`BACKUP_KEEP`). Also run
  before every production deploy and rollback, and daily at 02:30 (`install-daily-backup.sh` on macOS launchd, cron elsewhere).
- `scripts/restore-check.sh [env] [file]`: restores the newest backup into a throwaway database and compares row counts; never
  touches the live database.
- The keys (`secrets/backup.key`, `secrets/production.key`) are **not in the database backup** and must be kept separately; a
  backup alone cannot decrypt connections. Backups and exported archives are not otherwise protected.
- `docker compose down` preserves volumes; `down -v` deletes data and is never used on data to keep.

## Rollback (`scripts/rollback.sh`)

Backs up production, then restarts the previously recorded production image and swaps the recorded current and previous images.
The **database is retained**, so this is safe only because migrations are backward compatible. A restore from backup is a
separate, deliberate operation.

## Secrets and sharing

- Never commit `.env*`, `secrets/` or `backups/`; secrets travel through stdin or files, never arguments or logs.
- `scripts/scan-secrets.sh [--history] [--terms FILE]` looks for secrets and personal data in the files (and every commit),
  printing where, never the value (and runs gitleaks if installed).
- Personal files stay out of git: `CLAUDE.local.md` (the maintainer's own agent rules) and `private/` (their notes) are in
  `.gitignore`, so they live only in the maintainer's own clone.
- CI runs a **secret scan** (gitleaks, with the false positives in `.gitleaks.toml`) on every file, and on a pull request on
  every commit it adds.
- `SECURITY.md` says how to report a vulnerability privately.

## Versions

Each image carries the commit and build time (`COMMIT_SHA`, `BUILT_AT`, set by `deploy.sh` as build arguments; `-dirty` when the
tree has uncommitted changes): shown in the footer and sign-in page and in `GET /api/health`; `ship.sh` checks each environment
reports the commit it just deployed. Versions are tags (`v0.1.0`) and each tag publishes a container image; the changelog follows
Keep a Changelog ([`CHANGELOG.md`](../../CHANGELOG.md)).

## Acceptance checks

- A clean clone runs `./scripts/setup.sh staging && ./scripts/deploy.sh staging` and the smoke test passes on `:3002`.
- `deploy.sh` refuses a bind address that is not loopback or private, refuses to deploy production an image that is not the
  validated staging image (or whose id changed), and refuses production without its configuration and key.
- `ship.sh` refuses a dirty or unpushed tree, a feature branch without `--stage-only`, a `main` with unmerged commits and an image
  not built from this commit; it declines on anything but `promote` and stops before production when staging fails.
- The merge script refuses a commit that did not pass the local gate and one whose CI failed (`tests/merge-gate.test.ts`).
- A backup is encrypted, verified and rotated; `restore-check` reproduces the row counts; the rehearsal fails on a lost row and
  on a changed applied migration.
- `rollback.sh` restores the previous image with the database intact.
- Production smoke (`tests/production-smoke.ts`) reports mode `production` and the deployed commit, blocks data without a session and
  refuses foreign Host and Origin.
