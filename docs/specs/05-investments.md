# 05 · Investments

Part of the [specification](README.md). Read [00 · Principles](00-principles.md), [01 · Data contract](01-data-contract.md),
[03 · Connections and sync](03-connections-and-sync.md) and [04 · Accounts and net worth](04-accounts-and-net-worth.md)
first. This spec covers holdings, typed-in holdings, ticker prices, the benchmark lines, the portfolio return that
leaves out deposits and withdrawals, and the Investments page. The cash flows the return uses come from the Reports
lines ([07 · Reports](07-reports.md)).

## Why the return needs care

Plaid gives balances and holdings but no investment transactions, so the app cannot tell money added from money
earned. A chart of the plain balance reads every deposit, RSU vest or 401(k) contribution as growth (a +432% line
next to a +50% Nasdaq-100). The return below takes the cash flow out; where it cannot be computed, the page says
"value change" and never pretends otherwise.

## Data

- `securities(id, symbol, name, asset_class)`: id is `<connection id>:<Plaid security_id>`; asset class is `Cash`,
  `Bonds`, `Equities` or Plaid's type / `Other` ([03](03-connections-and-sync.md#the-sync-syncall)).
- `holding_snapshots(account_id, security_id, date, quantity numeric(28,12), price, value, cost_basis, provenance)`,
  primary key `(account_id, security_id, date)`. A sync deletes and rewrites the account's rows for the day, so **an
  empty successful holdings response supersedes the previous holdings**. `accounts.holdings_as_of` is the day of the
  latest holdings; the latest holdings of an account are the rows of that day. A null cost basis is unknown. Fractional
  shares are supported.
- `manual_holdings(id, account_id, symbol, name, asset_class, quantity > 0, price >= 0, updated_at)`: see below.
- `security_prices(symbol, date, close > 0)`: plain daily closes, see below.
- `benchmark_observations(symbol, date, level, provenance)`: dividend-adjusted closes of SPY and QQQ.
- `balance_snapshots.holdings_adjustment`: see [Ticker prices](#ticker-prices).

## Typed-in holdings

For an investment account the provider gives no holdings for: a manual account, or a synced one whose latest holdings
are empty (some brokerages report only "Unreported account value").

- `PUT /api/accounts/:id/holdings` `{holdings: [{symbol, name, asset_class, quantity, price}]}` replaces the whole list
  (at most 100). `symbol` is upper-cased and trimmed (at most 12 characters, may be empty), `name` 1-80 characters,
  `asset_class` `Equities`, `Bonds`, `Cash` or `Other`, `quantity` a decimal string above zero and `price` at or above
  zero (up to 14 integer and 8 fraction digits). Unknown fields are refused. Answers `{ok, count}`.
- Allowed only when the account is `investment` and (`source = manual`, or its latest `holding_snapshots` day, the
  `holdings_as_of` day or else the newest, has no rows). Otherwise "Holdings can only be entered for an account the
  provider gives none for". The account row is locked for the replace.
- `/api/overview` appends them to `holdings` with `provenance: 'manual'`, `security_id: 'manual:<id>'`, value =
  quantity × price, no cost basis, dated on `holdings_as_of` (today for a manual account), and **omits them as soon as
  the provider has holdings on that day**, so a sync never doubles them. They explain a balance but never change it,
  net worth or any provider data. The client mirrors the rule (`holdingsEditable`).

## Ticker prices

Holdings come from the bank (shares, ticker), but a ticker has **one price everywhere**: its latest close.

- **Download** (`refreshSecurityPrices`, step of every sync when `MARKET_DATA` is on, [03](03-connections-and-sync.md#the-sync-syncall)):
  for each ticker held in the last 14 days in a non-demo account, or typed in by hand (plain tickers only: `^[A-Z0-9][A-Z0-9.-]{0,9}$`,
  `BRK.B` requested as `BRK-B` and stored as held; at most 200), fetch Yahoo's unofficial chart endpoint
  (`query1.finance.yahoo.com/v8/finance/chart/<symbol>?interval=1d`, 20 s timeout) from a week before the first balance.
  In one transaction replace that symbol's rows from that day. The **plain** (not dividend-adjusted) close, on the
  exchange's local trading day, ignoring days without a positive close. **A failed or empty download keeps the stored
  rows and never fails the sync** (`prices.refresh_failed` is logged with the symbol only); a ticker Yahoo does not
  know simply shows the bank's price.
- **The client** shows a real (non-`simulated`) account's holding at the ticker's latest close if that close is within
  7 days of the holding's date and between half and double the bank's price (otherwise the bank's price). Its change
  runs from the first close in the range. The demo accounts keep their own prices.
- **The balance follows the closes** (`applyHoldingPrices`, after the download, even if it failed): for each
  `plaid_production` USD investment account, today's snapshot becomes the bank's balance + Σ quantity × (close −
  bank's price) over the holdings of `holdings_as_of` that have a close in the last 7 days between half and double the
  bank's price. The sum is stored in `holdings_adjustment`; a sync writes the bank's balance with an adjustment of 0 and
  this step applies it again (`current_balance − holdings_adjustment + delta`), so it is idempotent and a failed
  download leaves exactly the bank's balance. Net worth is recomputed. Earlier days keep the bank's balance. Sandbox,
  demo and manual accounts are never adjusted. The account page shows the bank's balance and the adjustment.
- **Unreported account value**: a placeholder row per account equal to the bank's balance (without the adjustment)
  minus the bank-valued holdings, when its absolute value exceeds 0.05 and the balance is known. It is always measured
  against the bank's own values, so the price difference never creates one.
- An on-demand sync stores the day's price as of that moment; the next scheduled sync replaces it with the close.

## Benchmarks

`SPY` ("S&P 500") and `QQQ` ("Nasdaq-100"), **dividend-adjusted closes** (`indicators.adjclose`), downloaded with
`period1=0` on each sync and stored whole: the series is **replaced, not appended**, because adjusted closes are
revised back in time after every dividend. Fewer than 20 rows is a failure. A failed download keeps the previous rows
and adds `BENCHMARKS_FAILED` to the sync message. The overview sends only the span from a week before the first
balance. Staging's demo dataset also offers its simulated benchmarks (US large cap, US total market, US bonds),
labelled "Simulated benchmark"; production has none. Weekends and holidays use the previous close; a benchmark's line
is its percent change from its first level in the chosen range. Production without Yahoo access (`MARKET_DATA=off`)
shows no benchmark lines and no price history.

## Portfolio return (Modified Dietz, monthly, chained; `src/lib/performance.ts`)

For one period (start, end] with start value `S`, end value `E` and dated flows `f` (positive = money added):

- `flow = Σ f` inside the period (strictly after start, up to and including end);
- weight of a flow = (days from the flow to the end + 0.5) / period length in days (a flow's own day counts as half);
- `gain = E − S − flow` (exact in dollars); `base = S + Σ weight × f`; `return = gain / base`, or `null` when `base ≤ 0`.

For a range the span **opens at the month end before the range start** (the last day of the previous month, or the
day before the start if that is already a month end), never earlier than the first known balance and never earlier than
the day before **`flowsFrom`**. It is cut at month ends, the month in progress ends on the latest balance, each piece is
a Modified Dietz period and the pieces are chained: `ret = Π(1 + r) − 1` (`null` if any piece had no base). The
chart line has one point per balance date: inside a month, the chained return so far plus that month's partial return,
so the line meets the chained figure on every month end; `gain` and `flow` are summed over the periods. It returns
nothing when there is no known balance at the opening or no day after it.

`returnStatus` says why a return is or is not shown: `ok`; `accounts` (only some investment accounts are selected: a
bank transfer cannot be assigned to one of them); `unloaded` (cash flows could not be loaded); `late` (`flowsFrom` is after
the latest balance); `nobase`. The result also carries `limit`, which of the three limits set the opening day: `range`,
`balance` (the first known balance) or `flows` (the day before `flowsFrom`). Without a return the page shows the plain **value change** and leaves Contributed out.

### Cash flows (`GET /api/investments/cash-flows`)

Computed **live every time, nothing stored** (an earlier stored version went stale when transactions were edited): per
day, the money added to (positive) or taken out of (negative) the investments = **income minus spending** on included
accounts, taken from the same lines Reports uses ([07](07-reports.md)): income and expense lines of included
accounts only, **transfers left out** (card payments, moves between your own accounts, to or from a brokerage), pending
rows not counted, a refund reducing spending. Amounts carry the provider sign, so the net flow is the negated sum.
It answers `{flows: [{date, amount}], from, auto_from, override}`.

- **`from`** (cash flows are counted from this day, the return never starts earlier, because before it deposits would
  read as growth): `override` if the owner chose one, else `auto_from` = the first day of the month after the
  earliest non-pending, non-removed USD transaction (own date, else the bank's) on an included `cash` account.
- With no bank transactions at all there is no automatic day, and the span opens at the first balance.
- `PUT /api/investments/cash-flows-from` `{date}` (real `YYYY-MM-DD`, not in the future) saves it in
  `settings.cash_flows_from`; `{date: null}` returns to automatic.
- The client also treats an investment account that **first appears after the history began** as a deposit of its
  first balance on that day (`appearanceFlows`).
- Known limits, stated on the page: it is only as good as the transactions (keep transfers categorised as transfers;
  keep 401k, RSU and ESPP in income categories); savings left in the bank count as invested; Modified Dietz is an
  approximation (about 0.3 points of error with deposits of half the balance); inside a month it is not time-weighted.
  It was checked on real data: cumulative returns agreed with the visible money moved into the brokerages within 0.1
  point, month by month within about 1.4 points.

## Investments page (`/investments`)

Mockups: [`docs/design/zen/`](../design/zen/) (Investments). The content is the contract:

- **Value card**: portfolio value, the **return** over the chosen range (ranges 1M, 3M, 6M, YTD, 1Y, All; the Home
  chart uses its own list) with the **gain** and what was **contributed**, a line **"Counted from <day> · opening balance <value>"** above the chart
  (with the reason in brackets when the first balance or the cash-flow start, not the range, set the day; amount masked in
  Private mode), and the chart, which starts on that same day (`valueSeries`) so the line and the line of text agree, of the return (or value change
  when no return can be computed). An (i) beside the headline explains the method with the numbers for the range and
  edits "cash flows from": the day is saved when the field loses focus or Enter is pressed (not on every change), **Use automatic** removes it, and a future day is refused. The (i) is also present when the chart shows plain value change, with the reason in words and the same day field, so a wrong day can always be put right. All accounts are selected by default; the account menu picks some (the button then reads
  "2 accounts"; **Clear**, or unpicking the last one, returns to all). Every benchmark that has data is drawn with its
  change over the range; clicking an index hides or shows its line (the portfolio line is always shown; not saved).
- **Allocation** card: a sentence on what leads, one bar split by weight, and the weights and values grouped by Asset
  class, Account or Security (`allocate`); hovering a part marks its row. Unreported value appears as its own part.
- **Holdings** table: Security, Shares, Price, Value and the price Change over the range; rows aggregate the same
  security across accounts (`aggregatePositions`: quantities and values sum, cost basis only when known for all);
  Unreported rows stay per account; click a header to sort (rows without a value last); **Export CSV** downloads the
  holdings. Clicking a row opens the **security detail**: price, change in dollars and percent, a chart from the
  ticker's closes (or the stored holding prices when there are none), quantity, value, and the accounts holding it.
- The page heading sentence: "Your portfolio is worth $268,820, down 8.54% so far this year" ([08](08-home-and-headings.md)).
- Private mode hides dollars and quantities, keeps percentages, weights and public prices; unrealised gain shows as a percentage.

## Acceptance checks

- Return maths (`tests/performance.test.ts`): a single period equals the formula; a deposit on the first day counts
  almost fully and one on the last day hardly at all; months chain so a large deposit in one month cannot distort
  another; the span opens at the month end before the range, never before the first balance or `flowsFrom`; points meet
  the chained figure on month ends; `gain` is exact; no base yields `null`; deposits of half the balance stay within
  about 0.3 points of the true return.
- `appearanceFlows`: an account that appears after the history began is a deposit of its first balance; the first
  account is not (`tests/performance.test.ts`).
- Benchmarks: Yahoo parsing uses adjusted closes and local trading days; fewer than 20 rows or a missing series is a
  failure that keeps the stored rows (`tests/benchmarks.test.ts`); the line is the percent change from its first level
  with the previous close carried over weekends.
- Prices: the symbol rules, the plain-close parse, a failed download keeps rows, the 7-day and half-to-double guards on
  both client and server, `holdings_adjustment` is re-applied from the bank's balance and never compounds, and only
  `plaid_production` USD investment accounts are adjusted (`tests/prices.test.ts`, `tests/holdings.test.ts`).
- Typed-in holdings: refused for a provider account that has holdings, for a non-investment account, and for invalid
  rows; a replace is atomic; they disappear from the overview once the provider supplies holdings; they never change a
  balance (`tests/schemas.test.ts`, integration).
- Unreported value: measured against the bank's own values, not the priced balance; hidden under 0.05
  (`tests/holdings.test.ts`).
- Cash flows (integration): income minus spending on included accounts, transfers and pending rows left out, a refund
  reducing spending, an excluded account ignored; `from` is the override or the first of the month after the earliest
  bank transaction; a future date is refused.
- UI (`tests/ui/investments.test.tsx`, `tests/ui/return.test.tsx`, `tests/ui/private.test.tsx`): the value card with
  return, gain, contributed and the counted-from line (plain, and cut by the cash-flow start); "value change" when only some accounts are selected or flows are unavailable; account
  menu and Clear; benchmark toggles; allocation grouping; holdings sort and export; security detail; Private mode.
