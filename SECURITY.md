# Security

Moneyrill stores sensitive financial data and bank connection tokens, so please report problems privately.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: on the repository page choose **Security → Report a vulnerability**. Please do not open a public issue or post details (or any real financial data, tokens or keys) in public. You can expect a first reply within a few days; this is a hobby project maintained by one person, so there is no guaranteed turnaround.

Useful in a report: what you did, what you expected, what happened, the version (the commit shown in the page footer), and whether it needs a signed-in session.

## What Moneyrill is designed for

- **One person, one computer, a trusted network.** There are no user accounts: one passphrase protects the app. It listens on `localhost`, and optionally on one private Wi-Fi address (`ALLOW_LAN`), never `0.0.0.0` on the host. For other devices, `tailscale serve` (`TAILSCALE_HOST`) keeps it on `localhost` and adds HTTPS on your private tailnet.
- **Do not put it on the internet.** There is no HTTPS of its own (only through `tailscale serve`), no rate limiting beyond sign-in lockout (per client address), no audit log and no multi-user separation. Over plain `http://` the passphrase and your data cross the network unencrypted, so use it only on a network you trust.
- **Your Plaid keys and bank tokens are yours.** Access tokens are encrypted at rest with a key file (`secrets/*.key`) that is never committed. Anyone with the database and the key file can read your connections, so protect both and keep backups encrypted (`scripts/backup.sh` does).
- **Defences in the app:** host and origin checks on every API call, `HttpOnly` / `SameSite=Strict` session cookie, a Content-Security-Policy, scrypt-hashed passphrase, validated request bodies, parameterised SQL, a container that runs as an unprivileged user, and production refusing sandbox/test data.

## Not covered

Attacks that need a machine you already control (malware, a stolen unlocked laptop), exposing the app to the internet against this advice, and weaknesses in Plaid, Docker or PostgreSQL themselves.

## Supported versions

Only the latest release and the `main` branch receive fixes.
