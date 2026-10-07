# 01 · Data contract: Plaid formats and integration rules

Part of the [specification](README.md). Read [00 · Principles](00-principles.md) first. This spec pins what the provider sends and the rules for storing it; the tables and endpoints built on it are in the feature specs.

Durable project notes, 2026-09-30, updated since. The implementation uses accounts and holdings, plus (from 2026-10-03) bank and card transactions via `/transactions/sync`. Investment transaction formats below are still only notes from earlier testing and are not used. These describe tested API shapes; they are not copies of the user's financial data.

## Bank / credit-card case

Direct `/accounts/get`: `{ accounts: Account[], item: Item, request_id }`.
Account fields used: account_id, name, official_name, mask, type, subtype, balances.current, balances.available, balances.limit, balances.iso_currency_code, balances.unofficial_currency_code, balances.last_updated_datetime when present.

Direct `/transactions/sync`: `{ accounts, added: Transaction[], modified: Transaction[], removed: [{transaction_id, account_id}], next_cursor, has_more, request_id, ... }`.
Transaction fields used: transaction_id, account_id, amount, iso_currency_code, date, authorized_date, name, merchant_name, pending, pending_transaction_id, personal_finance_category. Fields may be missing/null depending on institution. Preserve provider values and nullable fields.

Existing Quickstart `/api/accounts` passes through account response. `/api/transactions` instead returns `{ latest_transactions: Transaction[] }`, containing only the last eight added records. That truncation and nonpersistent cursor are demo limitations; do not copy them into the app.

Production testing with a real bank verified an account balance and posted transactions. Do not copy the live results into fixtures. Transfers/card payments are not ordinary expenses. Current credit balance is debt, while available credit is not an asset. Sandbox responses use the same contract but do not guarantee live institution coverage.

## Brokerage / investments case

Direct `/investments/holdings/get`: `{ accounts: Account[], holdings: Holding[], securities: Security[], item, request_id }`.
Holdings connect to accounts through account_id and securities through security_id. Important fields: quantity, institution_price, institution_price_as_of, institution_value, cost_basis, iso_currency_code. Null cost basis is unknown; retain full fractional precision.
Securities provide security_id, ticker_symbol, name, type, is_cash_equivalent, close_price, close_price_as_of, currency, and optional identifiers. Use security IDs for joins; ticker alone is not sufficient.

Direct `/investments/transactions/get`: `{ accounts, investment_transactions: InvestmentTransaction[], securities, total_investment_transactions, item, request_id }`.
Activity fields include investment_transaction_id, account_id, security_id, date, name, type, subtype, quantity, price, amount, fees, and currency. Do not assume bank transaction signs map directly onto investment activity; classify by type/subtype. Paginate until the reported total is covered.

Quickstart wrappers: `/api/holdings` returns `{error: null, holdings: <direct response>}`; `/api/investments_transactions` returns `{error: null, investments_transactions: <direct response>}`. The new app must normalize these or use the SDK directly.

## Connection lifecycle

A connected bank login is an Item, potentially with several accounts. Store item_id and access_token securely and independently for each connection. Frontend gets only public connection summaries. Use /item/get to inspect consent_expiration_time and error state. Reauthorization should use update mode on an existing Item. Sandbox and Production records must never share an identifier namespace.

The original test incorrectly set UI success even after an exchange failure; this was fixed. Preserve the rule: success only after durable save acknowledgement. Distinguish saved credentials from successful live API access.

## Sources

- https://plaid.com/docs/api/products/transactions/
- https://plaid.com/docs/api/products/investments/
- https://plaid.com/docs/api/items/
- https://plaid.com/docs/link/update-mode/

## Fixture rules

Create schema-conforming synthetic banking/investment payloads with matching account/security IDs and documented expected totals. No real tokens, account masks, user identities, transaction names, or balances from the provided screenshots. Include null fields, zero balances, card credits, fractional shares, brokerage cash, transfer pairs, duplicate imports, and missing history. History fixtures must be deterministic and explicitly marked simulated.

## Unified Add an account flow

Settings uses one Link entry point for banks and brokerages. New Link sessions initialize Transactions and request Investments through `additional_consented_products`, following Plaid's personal-finance guidance. Holdings are fetched only for Items with investment accounts. Reconnect uses the existing access token without adding products or exchanging another token, and sets `update.account_selection_enabled` so the owner can add or remove accounts; the sync that follows reads Plaid's current account list. An account removed and added back gets a new Plaid account id; the sync keeps the saved account (history, transactions, settings) and re-points it at the new id when exactly one saved account Plaid no longer returns has the same name, last digits, type and currency, and no other returned account fits. Otherwise a new account is created. In the sync where that happens, Plaid may send the account's recent transactions again under new transaction ids: each such new row is paired one-to-one with a saved row of the same account, date, amount and name (never pending rows, never rows dated on or after the account's previous sync), the saved row's edits and splits carry over, and the saved row is hidden. Unpaired rows are saved as new transactions.

Reference: https://plaid.com/docs/link/initializing-products/#transactions-with-liabilities-andor-investments

## Findings from the production check, 2026-10-03

Read-only, 5 rows per account shown, nothing stored. The brokerage-activity notes are in [06 · Transactions and categories](06-transactions-and-categories.md#not-built-yet-brokerage-activity).

- `/transactions/get` and `/transactions/sync` return bank and card transactions only: posted `date`, `amount` (positive = money out), `name`, nullable `merchant_name`, `pending`, `personal_finance_category` with `confidence_level`. `authorized_date` is present for some institutions only. History for existing Items is about 90 days.
- Plaid's category suggestions are noisy (card autopay lines can arrive as income or transfer), so the app maps them to editable categories and lets the user's choice win.
- Brokerage accounts return no rows from the bank endpoint. `/investments/transactions/get` returns buys, sells, dividends and transfers for a brokerage (type/subtype, quantity, price, fees, security), with the same positive-is-out sign, `amount=0` share transfers, `CUR:USD` cash rows and no sync cursor. Not implemented yet.
- New Link sessions pass `transactions.days_requested = 730`; update mode (Reconnect) does not.

## Typed-in holdings

`manual_holdings(account_id, symbol, name, asset_class, quantity, price)` holds one current list per account, replaced as a whole by `PUT /api/accounts/:id/holdings` (decimal strings; asset class Equities, Bonds, Cash or Other; at most 100 lines). It is accepted only for an investment account that is `manual`, or whose latest `holding_snapshots` day is empty (the provider supplies none). `/api/overview` appends the rows to `holdings` with `provenance: 'manual'`, `security_id: 'manual:<id>'`, value = quantity x price and no cost basis, dated on the account's `holdings_as_of` (today for a manual account), and omits them as soon as the provider has holdings at that day. They never change a balance, net worth or any provider data.

## Ticker prices

`security_prices(symbol, date, close)`: the plain (not dividend-adjusted) daily close from `query1.finance.yahoo.com/v8/finance/chart/<symbol>?interval=1d`, for each ticker held in the last 14 days in a non-demo account or typed in by hand (plain tickers only; `BRK.B` is requested as `BRK-B` and stored as held). Each sync replaces a symbol's rows from a week before the first balance; a failed or empty download keeps the stored rows and never fails the sync. `/api/overview` sends all rows as `prices`. The client shows a holding at its ticker's latest close (so one ticker has one price in every real account), computes its change from the first close in the range, and charts a security from the same history; without closes it falls back to the bank's price. The unreported remainder is computed from the bank's own values, never from these prices.

`balance_snapshots.holdings_adjustment` is the part of a snapshot's `current_balance` that comes from valuing holdings at `security_prices` instead of the bank's prices: for each holding of the snapshot's `holdings_as_of` day with a close in the last 7 days between half and double the bank's price, quantity x (close - bank price), summed. It applies only to today's snapshot of `plaid_production` USD investment accounts, is written after each price download, and is reset to 0 by every sync that writes the bank's balance (the bank's own balance is `current_balance - holdings_adjustment`). `/api/overview` sends it as `balance_adjustment`. The client measures the unreported remainder against `balance - balance_adjustment` and ignores a close under the same guards.
