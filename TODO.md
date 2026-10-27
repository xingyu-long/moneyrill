# TODO

Open items, roughly by priority. What the app does today is specified in `docs/specs/`.

## Remote access (future)

- [x] Sign-in with a single passphrase (done: session cookies, lockout, sign-out, first passphrase created in the browser, changed in Settings → Sign-in). HTTPS through `tailscale serve` is done (below). Still open: optionally a passkey (Face ID / Touch ID).

- [x] **Tailscale** for private phone/laptop access: `TAILSCALE_HOST` + `tailscale serve` (HTTPS on the tailnet, the app stays on localhost; see `docs/development/OPERATIONS.md`). Still open: check Plaid Link/Reconnect from a phone through it (OAuth banks may need `PLAID_REDIRECT_URI` on the ts.net name).

## Transactions

- [ ] Manual transactions do not move account balances. If you want a 401(k) or equity-awards balance to follow what you record (contributions, vests), that needs a rule for how a transaction changes a manual account's balance; today you enter the balance yourself.

- [ ] Splits: a per-part merchant name, weighted shares or percentages (even shares only for now), and carrying a split across a pending → posted amount change.

- [x] **Phase 1b: one-off Monarch CSV import** for bank and card accounts (Settings → Import from Monarch).
- [x] **Phase 2: brokerage activity** via `/investments/transactions/get`: downloaded on every sync, listed with the **Show investment accounts** switch, counted in Reports only once you categorise it. See `docs/specs/06-transactions-and-categories.md`.
- [ ] Brokerage activity, next: pair journals and zero-amount share moves between accounts; suggested categories (dividends, interest) and rules on it; activity per security in the security drawer; use deposits and withdrawals as the exact cash-flow source for the portfolio return.
- [x] Rules (Settings → Rules): conditions on merchant, statement, amount, category and account, set the category, preview and bulk update, applied on every sync. See `docs/specs/06-transactions-and-categories.md`.
- [ ] Rules, next: rename merchant, "Create a rule" from the transaction drawer, suggestions from repeated manual edits, optionally replacing your own choices.
- [ ] Tags, owner, review status, attachments, bulk edit, CSV export of transactions, import of `categories`/`transactions` from the JSON archive.
- [ ] Mapping editor for Plaid category -> category (the mapping is fixed in code; existing automatic categories are recomputed at start-up). Drag to reorder groups and categories.

## Reports

- [x] Reports tab: Cash flow, Spending, Income, with Date and Filters (categories, accounts). See `docs/specs/07-reports.md`.
- [ ] **Phase 2:** saved reports (Save / Reports menu; decide browser-only vs a `saved_reports` table), By group and By merchant breakdowns, stacked bars by category, Merchants, Amount and Tags filters, PNG download, "Edit multiple" on the report list, Weekly interval.
- [ ] Brokerage activity counts in Reports only once it has a category, yours or a rule's (no automatic categories yet).

## Data and accuracy

- [ ] Import Monarch history (daily balances per account) to backfill the net-worth chart and enable real performance numbers. The net worth side is in `docs/specs/04-accounts-and-net-worth.md` (`imported_net_worth`).
- [x] Real benchmark history: S&P 500 (SPY) and Nasdaq-100 (QQQ), dividend-adjusted, from Yahoo Finance on every sync.
- [ ] Real price history for held securities so the per-security charts have data (the same Yahoo fetcher could cover held tickers).
- [x] Investment return that excludes deposits/withdrawals: monthly Modified Dietz over cash flow taken live from the Reports lines (see `docs/specs/05-investments.md`).
- [ ] Portfolio return, phase 2: a per-account return (needs transfers assigned to an account), a Settings option for which accounts or categories count as cash flow, and Plaid investment transactions (Phase 2 brokerage activity) as a more exact source.

## Engineering

- [x] Branch + pull request workflow with local hooks, helper scripts and CONTRIBUTING.md. GitHub refuses branch protection for a private repository on the free plan (HTTP 403), so enforcement is local: hooks refuse commits and pushes on `main`, `merge-pr.sh` only merges green pull requests and `ship.sh` only releases from an unmodified `main`. To enforce it on GitHub too: upgrade to GitHub Pro, then run `python3 scripts/gh.py protect` (never make this repository public).

- [ ] Silence JSON request/exchange logs during `npm test` (set a quiet flag in tests).
- [ ] Replace the shared React context with narrower hooks if `useAppModel` keeps growing.
- [ ] Add a Playwright smoke test for Link and the add-account flow.

## Product

- [ ] Generic CSV import (and Monarch export mapping).
- [ ] Show a clearer message when a sync worker run happens in the background (the page needs a reload today).
- [ ] Replace the README's design mockups with real screenshots of the Zen app (`node scripts/screenshots.mjs` against staging; needs Docker): optional, the mockups illustrate the app until then.
- [ ] Decide whether Reports should leave out transactions of accounts switched off "Include in net worth" (today they count; the investment cash flows and the Transactions page sentence leave them out). Found while writing `docs/specs/07-reports.md`.
