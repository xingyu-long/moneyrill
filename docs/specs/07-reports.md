# 07 · Reports

Part of the [specification](README.md). Read [00 · Principles](00-principles.md), [04](04-accounts-and-net-worth.md)
and [06 · Transactions and categories](06-transactions-and-categories.md) first. Reports are read-only aggregates over
the transactions: **Cash flow**, **Spending** and **Income**, a page per category, a page per merchant, one shared
**Date** and one shared **Filters** control. **No database table is added.** The investment return also reads these
lines ([05](05-investments.md#cash-flows-get-apiinvestmentscash-flows)).

## What counts (the one rule set; `server/lib/reports.ts`)

Every report is built from **report lines** (`LINES_SQL`):

- an **unsplit** transaction is one line with its effective date (`coalesce(user_date, date)`) and effective category;
- a **split** transaction is its **parts**, each on its own date (`coalesce(part date, effective date)`) and in its own
  category (null = Uncategorized), never the parent as well;
- **not limited to included accounts:** the lines of an account switched off "Include in net worth" still count in
  Reports (the account filter is the only account scope), although the page sentences for Transactions and the investment
  cash flows leave such accounts out. This is how the app behaves today and looks like an oversight (it contradicts the
  principle in [00](00-principles.md)); a rebuild should decide it deliberately, and `TODO.md` tracks it;
- **left out entirely:** removed transactions, **pending** transactions (they can still change or disappear; Monarch
  skips them too; they stay listed on the Transactions page), and any non-USD transaction (counted once and mentioned
  as `skipped_non_usd`, never included).

The **kind** of a line is the type of its category's group (`income`, `expense`, `transfer`), except **Uncategorized**,
which counts **by direction**: money in = income, money out = expense. **Transfers (card payments, moves between your
own accounts) are never counted.** Amounts use the provider sign (positive = money out), so:

- **Income** value = `−amount` on income lines; **Expenses** value = `amount` on expense lines. A **refund** in an
  expense category (negative) lowers spending; a category whose refunds exceed its spending is left out of the donut (a
  donut cannot draw a negative slice) and shown with its sign elsewhere.
- **Net income** = income − expenses. **Savings rate** = net ÷ income as a percentage, one decimal, **null (shown "—")
  when income is not positive**. A **share** of a total is a percentage with one decimal, 0 when the total is not positive.
- The owner's changed date and category win over the bank's; a part's own date puts it in its own period.

## Periods (`periodStart`, `periodEnd`, `nextPeriod`, `fillPeriods`)

Intervals `day`, `month`, `quarter`, `year` on the server (the pages offer month, quarter and year). A period starts on
the 1st of its month, quarter (Jan, Apr, Jul, Oct) or year. `fillPeriods` returns every period from the range start to its
end with **zeros** where nothing happened (`'0.00'`), at most the last 600. A period is **partial** when the range ends
before the period does or, when the owner picked the start, when the range starts after the period begins.

## API (read-only; amounts are decimal strings)

Both take the same filters, validated by `reportQuery`: `from`, `to` (real dates, `from ≤ to`), `accounts` (comma list),
`categories` (comma list of ids), `merchant` (one, compared ignoring case), `interval` (default `month`), `type`
(`income`|`expense`, default `expense`), `breakdownFrom`/`breakdownTo`, and `today` (the browser's date). Invalid → "Invalid
report filter: use real dates, with the start not after the end".

- `GET /api/reports/cash-flow` → `{range, totals: {income, expenses, net, savings_rate}, series: Period[], breakdown: {from,
to, totals, income: Slice[], expenses: Slice[]}, first_date, last_date, skipped_non_usd}`. `series` covers the whole range
  from `from` (else the first transaction) to `to` (else the last transaction, **or `today` when that is later**, so the chart
  runs to the current, unfinished period). The `breakdown` uses `breakdownFrom/To` (default: the range) and carries its own
  totals. A `Slice` is `{category: {id, name, emoji, group}, amount, share}`, largest first.
- `GET /api/reports/categories` → `{type, total, slices, summary: {count (distinct transactions), largest, average, first_date,
last_date}}` for one side. `average = total ÷ count` (two decimals; '0.00' when none). Pass `categories` or `merchant` to
  get one category's or merchant's own summary.
- The category and merchant pages read the same two endpoints with `categories=<id>` or `merchant=<name>` and an interval.
  The transactions behind a page come from `GET /api/transactions` ([06](06-transactions-and-categories.md#reading-and-editing))
  with `type`, `categories` or `merchant`, and the same date and account filters.

## Date control (`src/lib/reportDates.ts`)

A **DateSpec** is one of: all time; a preset (Last 7 days, Last 30 days, This month, Last month, This year, Last year);
Last N units (day, week, month, quarter, year; N ≥ 1 and at most 36,500 / 5,200 / 1,200 / 400 / 100 respectively); or a
custom range. Ranges are **calendar days chosen in the browser**; "This month" and "This year" run to today; "Last N
months/quarters/years" = from the day after N units ago to today. **Reports opens on This year**; an address with no range
means this year; "All time" is explicit. A spec read back from local storage is accepted only if it validates.
Filters: categories (income and expense categories by group, with search) and accounts; **nothing chosen means everything**.

## Addresses

See also [09](09-settings-navigation-and-private-mode.md#addresses-srclibroutests-srcstaterouterts) for the other pages' addresses.

`/reports/cash-flow`, `/reports/spending`, `/reports/income`, `/reports/category/<id>?type=income|expense`,
`/reports/merchant/<name>?type=…`. Query: `range=` (`last-7-days`, `last-30-days`, `this-month`, `last-month`, `last-year`,
`all-time`, `last-<n>-<unit>s`; this year is the absence of `range`), or `from=&to=`; `categories=1,2`; `accounts=a,b`; for a
history page also `type`, `via` (the report it was opened from, for the way back), `interval=quarter|year` (month is
the default) and `period=<start day>`. A bare `/reports` returns to the **last report page used on this device**
(`moneyrill.reports.url`, reused only if it still parses), always over its default range (the range and filters are never
carried over). Addresses hold names, dates and ids, never amounts.

## Pages

Mockups: [`docs/design/zen/`](../design/zen/) (Reports, Category report). The content is the contract. Every page opens
with the page sentence of [08](08-home-and-headings.md) about the chosen range; **Cash flow, Spending and Income** are pills
beside the date and filter controls. Amounts follow Private mode (including chart axes); percentages stay; the CSV
downloads contain real values like the other exports (cells that start like a formula are prefixed with `'`).

- **Cash flow**: income and expense bars per period (side by side; the latest or chosen period solid, an unfinished period
  paler with the net line dashed from the last finished period), an interval menu (month, quarter, year) and a CSV download
  of the periods; four total cards (income, expenses, net income, savings rate); then **Spending by category** and **Income
  by source** side by side, each showing its six largest rows (a round emoji over a thin bar, **Show all** for the rest) with
  a link to the full report. The **breakdown** opens on the current month (quarter or year, by the interval) when the range
  reaches it; clicking a bar or the period menu picks another period, or the whole range; totals and chart keep the whole
  range.
- **Spending** and **Income**: a donut by category: the 11 largest, then **Everything else** in the muted colour (`legend`
  drops categories with no positive amount; "Show all categories" lists them all); the 12 slice colours are `--cat-1…12`;
  the transactions behind it grouped by date (click one to edit; the figures follow), clicking a legend item narrows the
  list to that category; a summary (count, largest, average, total, first and last date); a CSV of the categories.
- **A category, period by period**: opened from the Cash flow breakdown, a legend item or the donut (breadcrumb "Reports ›
  Rent"): one bar per period for that category (no value axis, the chosen period solid, the average as a dashed line,
  `averageOf`: finished periods only unless none; quiet periods count as zero), then the chosen period's transactions and
  summary. It opens on the latest period with activity, unless opened from a Cash flow breakdown period (then that period
  at the chart's interval). The date range and account filter still apply (a period that sticks out is cut to the
  range); **the category filter does not**.
- **A merchant's history**: from a transaction's "View N transactions": the same page for a merchant (the merchant name the
  bank gave, else the statement text, ignoring case; N counts every transaction of it, all time). Money in opens it as
  income and money out as spending; a **Spending | Income** switch shows the other side. A merchant that is only
  transfers shows an empty page. The date range and account filter carry over.
- Home links in: **Where it went this month** opens Spending on this month, and each row opens its category over this year
  with this month chosen.

## Acceptance checks

- Counting (`tests/reports.test.ts`, integration): transfers never counted; Uncategorized by direction; refunds lower
  spending and a negative category is dropped from the donut; a split transaction counts as its parts on their own dates
  and categories and never twice; pending, removed and non-USD lines left out (non-USD counted as skipped); the owner's date
  and category win; the account filter scopes the lines (no `included` filter today, see above).
- Periods: boundaries for day, month, quarter, year (leap years, year ends); `fillPeriods` zero-fills, caps at 600 and marks
  partial periods correctly with and without an explicit start; the savings rate is null without income and rounds to one
  decimal; shares round to one decimal and are 0 on a non-positive total (`tests/reports.test.ts`).
- Cash flow API: with no `to` the series runs to `today` when later than the last transaction; `breakdownFrom/To` narrow only
  the breakdown; invalid or reversed dates are refused; amounts are strings with two decimals.
- Dates (`tests/report-dates.test.ts`, `tests/calendar.test.ts`): every preset and "Last N", the N limits, end of month
  arithmetic, a stored spec that does not validate falls back to all time, reports default to This year.
- Addresses (`tests/routes.test.ts`): every route round-trips through `parseReport`/`reportUrl`; the default range is the absence
  of `range`; bad ids, periods and names fall back; the remembered URL is reused only when it parses.
- Legend (`tests/reports.test.ts`): 11 + Everything else, nothing drawn for non-positive amounts, colours cycle through 12.
- UI (`tests/ui/reports.test.tsx`, `tests/ui/private.test.tsx`): the three pills share one date and filter; breakdown period
  and "Whole range"; category and merchant pages and their switches; Show all; CSV cells; Private mode hides amounts and axes.
