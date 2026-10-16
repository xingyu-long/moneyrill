# Changelog

All notable changes. The format follows [Keep a Changelog](https://keepachangelog.com); versions are tags (`v0.1.0`) and each tag publishes a container image.

## [Unreleased]

### Fixed

- **Sign-in could be skipped with a percent-encoded path**: the sign-in and host checks looked at the path as written, but the router decodes it, so a request like `/%61pi/overview` reached the data without a session. The checks now use the route the request is routed to. Upgrade, especially with `ALLOW_LAN`.
- **Docs for the published image**: on Linux and a NAS the key file must be owned by user 1000 (`sudo chown 1000:1000 production.key`), otherwise every connection shows `SYNC_FAILED` with "Cannot read the token key"; the examples and OPERATIONS now say so. The restore steps say to wait for the first-start database setup to finish, and the download commands use `curl -fsSLO` so a 404 fails instead of saving an error page.

## [0.1.0] - 2026-10-15

### Added

- **Configurable ports**: `STAGING_PORT` (default 3002) and `PRODUCTION_PORT` (default 3003) set the port each environment is published on, in `.env` or, to override it, `.env.production`. The compose files, `deploy.sh`, `ship.sh` (smoke tests) and `rollback.sh` follow them, `PUBLIC_ORIGIN` matches, and `deploy.sh` refuses the same port for both. Defaults are unchanged.
- **An example for the published image**: `examples/compose.image.yaml` runs the app, worker and PostgreSQL from `ghcr.io/xingyu-long/moneyrill` without cloning or building (demo setup), and `examples/compose.image.production.yaml` does the same for real accounts; documented in Running Moneyrill, with backup, restore and upgrade steps.

### Changed

- **Personal files are ignored by git**: `CLAUDE.local.md` and `private/` (the maintainer's own agent rules and notes) are in `.gitignore`. The export script and its exclude list, which made a public copy of a private repository, are removed.

### Changed

- **The README shows real screenshots** of the staging demo app (`docs/screenshots/`), taken by `scripts/screenshots.mjs`; the design mockups stay in `docs/design/zen/`.
- **Production has no environment marks**: its top bar shows a round **Sync accounts** button instead of the badge, and the page has no colour strip. Staging keeps both.
- **The Accounts page has an Add an account button** beside its heading (the same Plaid Link as Settings → Connections).
- **Transactions can filter by a custom date range**: Custom range in When, with From and To calendar fields under the presets.
- **Home links match where they go**: This month opens this month's Cash flow report (it opened the default range); the Spending card opens the Spending report; "Where it went" says Spending. Each recent transaction opens its details on Home. The Reports breadcrumb names the page it returns to.

## [0.0.1] - 2026-10-07

First public release, covering everything built so far:

### Added

- **A Zen logo**: the net-worth line as a small stream on a cream tile, with the serif wordmark. New favicons, app icons and README logo (light and dark), all rendered from `docs/design/logo/icon.svg`.

- **Specification** (`docs/specs/`): principles and the Plaid data contract, the start of a feature-by-feature spec for rebuilding the app. `docs/DEVELOPMENT.md` and `docs/OPERATIONS.md` moved to `docs/development/`.

- **Home → Where it went this month** opens the Spending report on this month, and each row opens its category over this year with this month chosen. Reports now opens on **This year** instead of all time (`range=all-time` for all time; an address with no range means this year) and the Cash flow breakdown opens on the current month.

- **Accounts and net worth** from Plaid (banks, cards, brokerages) or by hand, with history, an account page and private mode that masks amounts.
- **Investments**: holdings, allocation, per-security detail, typed-in holdings where a provider gives none, daily closing prices, and a portfolio return that excludes deposits and withdrawals, with S&P 500 and Nasdaq-100 benchmarks.
- **Transactions** with editable date, category and notes, splits, manual transactions (RSU, 401(k)), pending handling, merchant history, and a one-off Monarch CSV import.
- **Reports**: cash flow, spending and income by category and merchant.
- **Home** page of modules, light and dark themes, phone layout with a configurable tab bar.
- **Sign-in** with one passphrase, encrypted token storage, encrypted verified backups, and opt-in private-Wi-Fi access.
- **Sync schedule** chosen in Settings → Sync settings & activity (every few hours, days, weekly or monthly, a time and time zone, or off; the worker follows it within a minute), with `SYNC_CRON` and `SYNC_TIMEZONE` as the default, and an off switch for Yahoo Finance market data (`MARKET_DATA=off`).
- Security headers (Content-Security-Policy, frame denial, `nosniff`), a non-root multi-stage container image, and sign-in lockout counted per client address.
- A short README with 2x WebP screenshots (`node scripts/screenshots.mjs`, Playwright kept outside the project); the detailed reference moved to `docs/FEATURES.md`, `docs/OPERATIONS.md` and `docs/DEVELOPMENT.md`.
- MIT license, `SECURITY.md`, issue and pull request templates, and scripts to scan for secrets and to export a clean copy.

### Changed

- `vercel.json` turns off Vercel's automatic deployments of this repository's branches; nothing is published from it until that is changed on purpose.
- `INSTANCE_NAME` (default `moneyrill`) names the Docker projects, database volumes and database user, so a new installation is `moneyrill-*` and an existing one keeps its names by setting it; `deploy.sh` refuses to start an installation under a new name when another installation's database volume exists. The release image is now tagged `moneyrill-release`, and the public export no longer rewrites any file.
- Ready to publish: personal agent rules and notes moved to a private overlay (`CLAUDE.local.md`, `private/`) that the export leaves out; the demo data uses only made-up names; CI scans every file and pull request for secrets (gitleaks).
- The container image is smaller (production dependencies only) and runs as the `node` user. Key files mounted into it must be readable by uid 1000.
- `deploy.sh` runs the unit tests in the build stage (the slim runtime image has no tests) and fails if no tests ran.
- An unreadable, missing or malformed token key is reported in plain words at start-up and when a connection needs it.

### Fixed

- On a phone, a long transaction name (a Zelle line) widened the Transactions page so it scrolled sideways and the amount overlapped the name; long names now end in an ellipsis.
