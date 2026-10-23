# 04 · Accounts and net worth

Part of the [specification](README.md). Read [00 · Principles](00-principles.md), [01](01-data-contract.md),
[02](02-foundation.md) and [03](03-connections-and-sync.md) first. This spec covers the account model, accounts you
keep by hand, balance history, how net worth is computed on the server and on the client, the `overview` payload
every page reads, and the Accounts page and account page. Investment accounts' holdings are in
[05](05-investments.md); the account's transactions in [06](06-transactions-and-categories.md).

## Account model

`accounts` ([02](02-foundation.md#database)): `id` (text), `connection_id` (null for manual and imported accounts),
`provider_id`, `name`, `institution`, `kind`, `currency`, `mask` (last digits), `included`, `source`, `last_synced`,
`last_error`, `provider_as_of`, `holdings_as_of`.

- `kind` ∈ `cash`, `credit`, `investment`, `loan`. **`credit` and `loan` are liabilities** (their balance is debt,
  shown as a positive number); `cash` and `investment` are assets.
- `source` says where data comes from: `plaid_production`, `plaid_sandbox`, `simulated` (staging demo), `manual`,
  or an import name. It decides what the owner may edit (below) and what an environment shows (below).
- `included` (default true) says whether the account counts in net worth, reports and the portfolio. The owner can
  switch it on the account's page. A sync never changes it, except the one-time exclusion of an account the bank
  stopped returning ([03](03-connections-and-sync.md#the-sync-syncall)).
- `last_error` carries the connection's state on the account: a Plaid error code, `DISCONNECTED` or
  `ACCOUNT_NOT_RETURNED`.
- **What an environment shows** (`visibleAccounts`): production shows every account except `simulated` and
  `plaid_sandbox`; staging shows either the demo set (`simulated`) or everything else, by a dataset choice
  (Settings → Display). Hidden accounts are not in any total.

## Balances and history

- `balance_snapshots(account_id, date, current_balance, provenance, observed_at)`, **one row per account per UTC
  day**; writing the same day replaces it. `current_balance` is `numeric(24,8)`, null when unknown. `provenance` is
  `plaid_<env>`, `manual`, `simulated` or `imported`. `balance_observations` keeps every write (trigger), so nothing
  is lost.
- An account **enters history on its first snapshot**; history is never back-filled for it or reconstructed from
  current holdings. Charts use one point per UTC day, and switching an account's inclusion applies to the displayed
  history, past days included.
- A negative card balance keeps its sign. Totals may combine observations from different institution refresh times;
  each account's own timestamp stays visible.
- The **latest balance** of an account is its newest snapshot (`/api/overview` → `accounts[].balance`,
  `balance_date`, `provenance`, and `balance_adjustment` for [05](05-investments.md)).

## Manual accounts

For things a bank cannot report (a 401(k), equity awards, a house, cash).

- `POST /api/accounts` `{name, institution?, kind, balance}` → `{id}`. `name` must not be blank, `kind` one of the
  four, `balance` a finite number or numeric string (an empty string is refused). Creates the account with
  `source = manual`, currency `USD`, `institution` defaulting to "Manual account", and today's snapshot with
  provenance `manual`; recomputes net worth, all in one transaction. The UI is **Settings → Data → Add a manual
  account**; it is unavailable in Private mode.
- `PATCH /api/accounts/:id` `{included?: boolean, balance?}`:
  - `included` can change on **any** account.
  - `balance` is accepted **only** when `source = manual` (otherwise "Only manual balances may be edited"): it writes
    today's snapshot (replace if present), sets `last_synced = now()`. The balance of a provider-supplied account is
    never editable.
  - Always recomputes net worth in the same transaction; unknown id → "Account not found".
- A provider-supplied account is read-only wherever the provider supplies the data. The only other thing the owner
  may type in is holdings ([05](05-investments.md)).

## Net worth

**Server (`recompute`, `daily_net_worth`)**, run after every sync, manual change and import, under advisory lock
`931878`. It rebuilds the whole table: for every date that has any snapshot, take each **included** account's latest
snapshot on or before that date, then

- `assets` = sum of balances of `cash` and `investment` accounts in USD;
- `liabilities` = sum of balances of `credit` and `loan` accounts in USD;
- `net_worth` = assets − liabilities, over USD accounts;
- `missing_accounts` = included accounts whose balance is null or whose currency is not USD (they are **left out of
  the sums and counted**, never silently dropped).

**Imported totals.** `imported_net_worth(date, assets, liabilities, net_worth, source, imported_at)` holds totals
imported from another tracker for accounts this app cannot see. `recompute` uses them for the days **before** every
included account has a live (non-`imported`) observation; from the first day all included accounts have live data, the
live totals win. When any imported row exists `/api/overview` returns `netWorth` rows (`date`, `net_worth`) for the
client chart; otherwise `netWorth` is empty and the client derives history itself.

`server/lib/math.ts` has the same rule as a pure function (`netWorth(accounts)`) used for tests: skip excluded
accounts; skip, and count as missing, a null balance or non-USD currency; liabilities for `credit` and `loan`;
strings in, two-decimal strings out (`decimal.js`). `periodStart(end, range)` maps `1M, 2M, 3M, 6M, 1Y` to that many
months back, `YTD` to Jan 1, `ALL` to 1900-01-01.

**Client** (`src/lib/accounts.ts`, `src/lib/history.ts`, `src/state/useAppModel.ts`):

- `summarizeNetWorth(included)` → assets (cash + investment), liabilities (credit + loan), net = assets − liabilities,
  over included USD accounts with the latest balances. A brokerage balance already includes its holdings.
- `balanceHistory(accounts, balances, from, signed)` → one point per date with a snapshot (on or after `from`):
  each account's latest balance up to that date, summed, liabilities negated when `signed`. An account contributes
  only from its first snapshot. A date where an included account's balance is unknown has `value: null` and a
  `missing` count (the chart shows a gap, not a wrong number).
- **Range**: `1M, 2M, 3M, 6M, YTD, 1Y, ALL` (`startDate(lastBalanceDate, period)`), and on Home also `1D`, `1W` and a custom
  From/To; the last balance date is the newest snapshot, not today. `1D`, `1W` and a custom range open on the last snapshot
  on or before their first day (`openingDate`), since a sync may not run every day. A custom range that ends before the
  last balance date stops the chart there, and its change runs to its last point instead of today's balances. The imported series replaces the derived one only on the unfiltered view.
- **Change** over the range: `delta = net − first point`, `pct = (net / first − 1) × 100`, unavailable (`null`) when
  there are fewer than two points, or the baseline is zero, negative or unknown.

## `GET /api/overview`

One read-only payload for every page: `accounts` (with latest balance fields), `balances` (every snapshot: account id,
date, balance, provenance), `holdings` ([05](05-investments.md), provider and manual), `prices`, `benchmarks`
(only from a week before the first balance), `runs` (last 8 sync runs), `connections` (public fields), `netWorth`
(above), `mode`, `environment`, `hasSandboxKeys`/`hasPlaidKeys`. It contains no tokens.

## Accounts page (`/accounts`)

Mockups: [`docs/design/zen/`](../design/zen/) (Accounts). Layout is a guide; the content is the contract.

- **Net worth card**: the amount, the change over the range, a bar of assets against liabilities with both figures,
  a note saying what is counted (accounts left out because their balance is unknown or not USD), the export link, the
  chart with its range selector. Private mode hides the amounts.
- **Your accounts**, grouped by kind in this order: Investments, Cash, Credit cards, Other debts (that group only when
  an account exists), each a card the owner can fold from its heading, with the group's total and its change over the
  range. Each account shows a round initial of its institution in a colour derived from the name (the same every
  time), its name and last digits, a 30-point trend line, the balance and when it was last updated. An account whose
  sync failed carries a clay **Reconnect** tag; a disconnected one says so.
- **Search** (name and institution) and **sort** (by balance, descending, or by name) apply to every group. A click
  opens the account.

## Account page (`/accounts/:id`)

The balance with its change over the chosen range and a chart; then the account's transactions (bank and card
accounts, [06](06-transactions-and-categories.md)) or its holdings grouped by type (investment accounts,
[05](05-investments.md)); a summary (institution, type, currency, **Include in net worth** switch) and the
connection status: "Connected", "Sync needs attention", "Disconnected", "No longer shared by the bank", "No
connection" (manual) or "Not connected", with the provider (Plaid, Plaid Sandbox, Demo data, Entered by hand,
Imported) and the last update. A manual account's balance is editable here; a provider's is not.

## Acceptance checks

- Net worth: excluded accounts never count; liabilities subtract; a null balance or non-USD account is left out and
  counted as missing; strings in, exact two-decimal strings out (`tests/math.test.ts`).
- History: an account enters at its first snapshot and is never back-filled; the latest balance up to each date is
  used; an unknown balance yields a gap with a missing count; liabilities are negated only when `signed`
  (`tests/history.test.ts`).
- Visibility: production never shows `simulated` or `plaid_sandbox` accounts; staging shows one set (`tests/accounts.test.ts`).
- Manual accounts: blank name, bad kind or an empty or non-numeric balance are refused; the balance of a
  provider-supplied account cannot be edited but `included` can; a same-day edit replaces the snapshot and the
  observation history keeps both; recompute runs in the same transaction (integration).
- `recompute`: imported totals are used only before every included account has live data; the live totals then win.
- A repeat sync or import adds no duplicate snapshot rows (integration).
- UI (`tests/ui/accounts.test.tsx`, `account-page.test.tsx`, `manual.test.tsx`, `private.test.tsx`): groups and order,
  fold, search and sort, Reconnect tag, the status wording, manual balance editable and provider balance not, Private
  mode masks every amount.
