# 00 · Principles

Part of the [specification](README.md). Every feature spec assumes these rules; where a feature spec seems to
contradict them, these win. They are written so a person or a coding agent starting from an empty repository builds
the same app.

## What the app is

A self-hosted personal finance app for **one person on a trusted network**: net worth across bank, card, loan and
investment accounts; holdings and portfolio return; editable transactions; reports. Local first: PostgreSQL on the
owner's machine, bank tokens encrypted at rest, everything saved keeps working with no internet (new syncs and
Plaid Link need it). It holds real financial data, so safety rules outrank convenience.

## Stack and layout

- Node + TypeScript. **Fastify** API (`server/`), **PostgreSQL**, **React + Vite** UI (`src/`), Tailwind CSS v4 with
  shadcn-style primitives, Docker for every environment.
- `server/routes/*` are thin: parse with the zod schemas in `server/lib/schemas.ts`, call a service, return JSON.
  `server/services/*` hold the logic and the SQL. `server/lib/*` are pure helpers with no I/O.
- `src/lib/*` are pure and unit-tested; `src/state/*` are hooks and context; `src/components/*` are UI.
- Tests: `tests/*.test.ts` (server and pure code), `tests/ui/*` (React, vitest), `tests/integration.ts` (API against a
  disposable database), `tests/smoke.ts` (a running stack). A feature is not done without tests that cover its
  invariants as well as the happy path.

## Money, dates and numbers

- Money is `decimal.js` or **decimal strings**, never floating point. Amounts have two decimals; quantities keep full
  fractional precision.
- Dates are UTC calendar days (`YYYY-MM-DD`); a timestamp is stored with its zone.
- **Sign convention.** Plaid's sign is kept in storage: positive = money out, negative = money in. The UI shows money
  in as `+$x`. Credit-card and loan balances are **liabilities** (debt); available credit is never an asset.
- Net worth counts only accounts included in it, in USD, with a known balance. Anything left out is counted and
  said ("N accounts left out"), never silently dropped.
- Charts and percentages computed on the client use values the server already rounded; the server is the source of
  truth for totals.

## Rules every feature obeys

1. **User edits win over synced data.** A sync never overwrites a category, note, date, split or setting the owner
   changed. Edits are stored apart from the provider's row.
2. **A failure in one provider or step never breaks the others, and never rolls back what already succeeded.** A
   failed transactions download keeps the balances; a failed price download keeps the stored prices; failed syncs
   keep the prior data.
3. **An excluded account never counts** in net worth, the portfolio and the investment cash flows. (Known gap: the
   transaction Reports do not filter on it today, only on the account filter; see [07](07-reports.md#what-counts-the-one-rule-set-serverlibreportsts).)
4. **Success is reported only after durable save.** Never show "connected" or "saved" before the database
   acknowledges it. Saved credentials and working live access are different states.
5. **Imports and syncs are idempotent.** Repeating one adds only what is new.
6. **Nothing disappears silently.** An account or transaction the provider stops returning is marked or hidden, with
   the owner's edits kept, and comes back if it reappears.
7. Sandbox/demo and production data never share an identifier namespace; production refuses sandbox and test data.

## Privacy

- **Never log** balances, holdings, tokens, account numbers or CSV contents. All logging goes through
  `server/lib/log.ts` (one JSON line per event, fields never include financial data).
- **Private mode** hides every amount, share count and chart dollar axis and tooltip, while percentages, weights,
  counts and public security prices stay visible. Anything that needs the amounts (editing a balance, splitting,
  adding a transaction) is unavailable while it is on. It is remembered on the device only (`moneyrill.private`).
  Page summary sentences and URLs follow it: addresses carry page names, dates and ids, never amounts.
- Fixtures and examples use synthetic data only. No real names, masks, merchants or balances in the repository.
- Never copy production data into staging. Staging is fake data plus Plaid Sandbox.

## Security

- Listens on `localhost` and, only if enabled, one private Wi-Fi address; never `0.0.0.0` on the host, never tunnelled.
  Sign-in becomes mandatory off localhost.
- One passphrase (scrypt-hashed), `HttpOnly`, `SameSite=Strict` session cookie, host and origin checks on every API
  call, a strict Content-Security-Policy, validated request bodies, parameterised SQL, a container that runs
  unprivileged. Details: [SECURITY.md](../../SECURITY.md).
- Plaid access tokens are encrypted at rest with a key file that is never committed. Secrets travel through stdin or
  files, never command-line arguments, and are never echoed.
- **No requests to other hosts at run time** except the data providers named in the feature specs (Plaid, and
  optionally Yahoo Finance for prices, switchable off). Fonts and icons are bundled; the CSP allows `'self'` only.

## Database

- Schema changes are numbered, **additive** SQL files in `server/db/migrations/` (`NNN_name.sql`), applied once inside
  a transaction and recorded with a checksum. An applied migration is never edited. Dropping or renaming a column
  needs a deliberate backup and restore plan. A migration is rehearsed on a restored copy of production before release.
- `server/db/seed.ts` is demo and staging data only.

## Persisted keys and names

Browser-side choices live under named constants, never repeated strings: `moneyrill.theme`, `moneyrill.private`,
`moneyrill.home`, `moneyrill.tabbar`, `moneyrill.reports.url`. They are per device and never carry amounts.

## Look and feel: Zen

The app wears one design, **Zen**, in light and dark. The mockups are in [`docs/design/zen/`](../design/zen/) (fake
data); they are the target for colour, type and mood, not a pixel contract for layout.

- **Mood.** Calm sage-and-cream, a tall serif for headings and big numbers, soft rounded cards without borders, and
  every page opens with one plain sentence built from the user's own data.
- **Colours are variables.** `src/theme.css` is the only place a colour may be written; it holds each variable for
  dark (`:root`, the default, "Zen night") and light (`:root[data-theme='light']`), and a test fails if a hex colour
  appears anywhere else in `src/`. Charts and categories use the same variables.
- **Tokens** (light / dark): page `#eef1ea` / `#121714`; card `#fbfcf8` / `#1a211c`; muted surface `#f3f5ef` /
  `#212a24`; hover and selected `#dfe7da` / `#26332b`; hairline `#e7ebe3` / `#26302a`; text `#1f2a22` / `#e6ebe3`;
  muted text `#66706a` / `#8d998f`; positive `#4d7c57` / `#93c49f`; sage (links, focus, chart line) `#5b7a62` /
  `#93b59b`; negative `#a35a3f` / `#e0957a`; clay (debt, bars, Reconnect) `#c98b6b` / `#d79c7d`. The full list,
  including twelve category colours, is `src/theme.css`. Body text meets 4.5:1 contrast in both themes.
- **Shape.** Cards 26px radius (22px on phones), no border, a soft shadow; lists inside a card use 1px hairlines;
  buttons and chips are pills. The primary button is ink on cream.
- **Type.** Instrument Serif for headings, big numbers, summary sentences and highlighted figures (serif italic in
  sage, debts in clay); Inter for everything else; both bundled (SIL Open Font License). Amounts are always
  `tabular-nums`. Sizes on laptop / phone: page title 64 / 44px, page sentence 24 / 19px, hero net worth 112 / 64px
  with the cents muted.
- **Navigation.** A sticky pill bar at the top on a computer (Home, Accounts, Investments, Transactions, Reports,
  with search, the theme toggle, Private mode and Settings); a floating pill tab bar on a phone.
- **Logo and icons**: the net-worth line as a small stream (a rill) in sage on a cream tile, beside the wordmark `money` +
  italic sage `rill`. The sources are `docs/design/logo/icon.svg` (and `icon-small.svg`, a heavier line for 16-48px); every
  icon in `public/` and `docs/logo*.png` is rendered from them.
- **Theme choice** (match device, light, dark) is stored on the device and applied before first paint.

## How to use this spec

Build in the order given in the [index](README.md#build-order). Finish a spec's acceptance checks before starting the
next one. If a spec is silent, follow the surrounding code and these principles, and write down what you chose.
