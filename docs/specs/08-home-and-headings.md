# 08 · Home, page headings and summary sentences

Part of the [specification](README.md). Read [00 · Principles](00-principles.md) (the Zen look), [04](04-accounts-and-net-worth.md),
[05](05-investments.md), [06](06-transactions-and-categories.md) and [07](07-reports.md) first. Home reads figures the other
pages produce; the headings give every page one plain sentence built from the owner's own data. Nothing here adds a table or
an endpoint: it reads `GET /api/overview`, `GET /api/reports/cash-flow` and `GET /api/transactions`.

## Page headings (`src/components/PageHeading.tsx`, `src/lib/summary.ts`)

Every page opens with its name as a **large serif title** and **one sentence** under it, in muted serif with key figures
highlighted. **Home** is different: one small centred line (greeting plus sentence) over the net worth hero.

- **Title** (`pageTitle`): Home shows the greeting for the hour, `Good morning.` before noon, `Good afternoon.` before 6 pm,
  else `Good evening.`; every other page shows its own name (Accounts, Investments, Transactions, Reports, Settings).
  A category or merchant report has the Reports title and **no sentence** (it has its own figures).
- **A sentence is returned as parts, not a string**: `{text, style?}` with style `money` (an amount: whole dollars via
  `cashWhole`, **masked in Private mode like every amount**), `figure` (a highlighted number or phrase; serif italic in
  sage) or `warn` (needs a look; clay). **Counts and percentages are never masked.** While figures load, only the title
  shows and the sentence line keeps its height so the page does not jump. A count of 0-12 is spelled out ("ten"), larger
  ones in digits (`spell`). The tone is short and factual, no advice.
- **Wording** (exact text; `…` is data):

| Page                                  | Sentence                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                                  | "Here's where you stand today." (after the greeting)                                                                                                                                                                                                                                                                                                                                                                                                                |
| Accounts                              | none: "No accounts yet." · one or more: "Ten accounts, all synced within the last 5 hours." (a single account omits "all"; the age reads "hour", "N hours", "day" or "N days" from the oldest bank-synced account; with none bank-synced just "Ten accounts.") · with problems: "Ten accounts. **One needs reconnecting.**" / "**Three need reconnecting.**"                                                                                                        |
| Investments                           | none: "No investment accounts yet." · "Your portfolio is worth $268,820, **down 8.54%** so far this year." (the return; when only the value change is available: "…is worth $X, with its value **up 3.10%** over the last month."); no change available: "…is worth $X."                                                                                                                                                                                            |
| Transactions                          | none this month: "Nothing yet this month." · "47 this month, $3,200 out and $5,100 in." (`47+` when more than were counted) plus " One is still pending." / " Three are still pending."                                                                                                                                                                                                                                                                             |
| Reports (Cash flow, Spending, Income) | `<lead> you earned $X and spent $Y. You kept **N%**.` · rate negative: "…You spent more than you earned." · no income: "`<lead>` you spent $Y." · neither: "`<lead>` there was no income or spending." · **with filters chosen**: "`<lead>` your filters match $X earned and $Y spent." (no rate). Lead: Over all time · This year · Last year · This month · Last month · In the last 7 days / 30 days · In the last N units · "From Jan 1, 2026 to Mar 31, 2026," |
| Settings                              | "Everything stays on this machine, in your own database." plus, if any connection needs attention, " **One connection needs your attention.**" / "**Three connections need your attention.**"                                                                                                                                                                                                                                                                       |

The Transactions figures come from this month's report totals (as the reports count them) and this month's transaction
list (an account switched off "Include in net worth" never counts there); the Accounts age uses `last_synced` of non-manual
accounts. The wording is tested in `tests/summary.test.ts`.

## Home (`/home`, also `/`)

Mockups: [`docs/design/zen/`](../design/zen/) (Home, light and dark; phone board 1). Net worth is **always the hero**, above
the cards, and is not one of the cards that can be hidden or moved.

### The hero

- The amount, centred, in 112px serif (64px on a phone) with the **cents muted**; Private mode shows six dots at a smaller
  size (72 / 44px) so they are not a wall of bullets.
- A **pill** saying how much it changed, by how much in percent, and over what: `+$161,200.12 (+2.31%) since last month`
  (an up arrow, accent colour) or `−$… (−…%)` (a down arrow, warning colour); in Private mode only the **percentage**. The
  percentage is left out when the baseline is zero or negative. With no baseline: "Not enough history yet". The words are
  `changePhrase`: 1D "since yesterday", 1W "since last week", 1M "since last month", 2M/3M/6M "over the last N months", YTD
  "so far this year", 1Y "over the last year", All "since the start", a custom range "from Jul 1, 2026 to Sep 30, 2026".
  A 1D or 1W range with no snapshot on its first day opens on the last snapshot before it and says so: "since Oct 1, 2026".
- A range selector **1D, 1W, 1M, 3M, YTD, 1Y, All** and **Custom** (`HeroRange`), the same period as the figures use. It is
  Home's own (`homePeriod`): a range picked here does not change Accounts or an account page, and they do not change it. **Custom** opens a From and To picker (no day after today; the start must be before the
  end, otherwise Apply is off and it says so) with shortcuts that fill both in (This month, Last month, Last year). Apply
  makes it the range and the button shows its dates; Cancel, Escape or a click outside leaves the range as it was; picking a
  preset leaves the custom range. The range is not saved: a reload opens on 1M.
- The **net worth chart** below it: just the line and its fill (no axes or grid), **edge to edge** (negative margins undo the
  page padding), with the hover tooltip. The cards that follow **overlap the chart's lower edge by 44px**, so the chart keeps
  a 56px empty margin below the line (and its height is 280px) so a dip in the line never runs behind a card. With fewer than
  two points: "Your chart will grow as balance snapshots accumulate."
- The figure is `summarizeNetWorth` over included USD accounts; the change and chart come from `balanceHistory`, or the
  imported series, exactly as in [04](04-accounts-and-net-worth.md#net-worth).

### The cards (`HOME_WIDGETS`, default order)

Each card is a borderless rounded tile with a small eyebrow title and, where there is a page for it, a link named for the page it opens: "Cash flow →" (This month: this month's Cash flow report), "Spending →" (the Spending card and "Where it went": the Spending report), "Transactions →" (Recent transactions).
Most say it in a sentence over a thin meter and a few figures.

| Id             | Title                    | Content                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `month`        | This month               | `monthSentence`: income ≤ 0 and expenses > 0: "No income yet this month. You have spent $X." · neither: "No income or spending yet this month." · no rate: "Nothing to compare yet this month." · rate < 0: "You spent $X more than you earned this month." · else "You've kept **N%** of your income this month."; a meter of the savings rate; figures In, Out, Kept. Links to Reports.  |
| `assets`       | Assets and debt          | `assetsSentence`: "You own $A and owe nothing." / "You own $A and owe $L." (debt in clay); a meter of assets against assets + debt; figures You own, You owe; a note "N accounts counted" (and "· N need attention").                                                                                                                                                                      |
| `investments`  | Investments              | `portfolioSentence`: "Your portfolio's value is **up 10.98%** over the last month." (the **value** change, money added counts) or "Not enough history yet."; figures: Total and the top three positions by value. Links to Investments. "No investment accounts yet." when none.                                                                                                           |
| `categories`   | Where it went this month | The five largest expense categories this month (from the cash-flow report's breakdown): a round tinted emoji, the name, a thin bar relative to the largest, the amount and its share. The tile links to the Spending report on this month; each row to that category over this year with this month chosen ([07](07-reports.md#pages)). "No spending recorded this month yet." when empty. |
| `transactions` | Recent transactions      | The six newest transactions: emoji, merchant (else statement text), a Pending badge, date and category, signed amount. Its link goes to Transactions; each row opens that transaction's details in place, as the Transactions page does.                                                                                                                                                   |
| `spending`     | Spending trend           | Running-total comparison chart, below. **Off by default.**                                                                                                                                                                                                                                                                                                                                 |
| `accounts`     | Accounts                 | One row per kind (Cash, Investments, Credit cards, Loans) with the count and total of included accounts. **Off by default.**                                                                                                                                                                                                                                                               |

Layout: a 12-column grid on a wide screen (month, assets, accounts, investments span 4; categories 5 and transactions 7),
two columns on a tablet, one on a phone. Amounts follow Private mode.

### Spending trend

"Money out so far in one period against another, as running totals." A menu in the card picks the mode, saved in the Home layout (`compare`). Modes (`COMPARE_MODES`): This week vs. last week;
**This month vs. last month (default)**; This month vs. last year; This month vs. average month; This year vs. last year.
The data is the Reports cash-flow series (`comparisonPlan`: per day for weeks and months, per month for years; the range
starts at the earliest period compared). A period that has not reached a slot yet has no value there, so its line stops at
today. The **average month** is the mean of the previous 12 months' running totals, counting only months from the first one
with spending (a new account's empty past does not drag it down). Weeks start on Sunday.

### Customize Home (Settings → Display and navigation → Customize Home; also reachable from an empty Home)

A dialog listing every card with a switch to hide it and a handle to drag it (the others glide out of the way; near the
edge the dialog scrolls); the **keyboard** way is move up / move down. Net worth is
not in the list. When every card is hidden Home says so and offers Customize.

The choice is kept **on this device** (`moneyrill.home`, JSON `{order, hidden, compare, v}`), repaired on read: unknown or
repeated ids are dropped and ids added by a later release are appended (shown), so an old or damaged value never hides
or loses a card; a value saved under an older design (`v` ≠ 2) is not used. There are no Sync or Customize buttons on the
pages. The **Accounts** page has one **Add an account** button beside its heading (the same Plaid Link as Settings →
Connections; off without Plaid keys) and no other page has one. Syncing is in Settings → Connections and, in production,
the round **Sync accounts** button in the top bar; adding a manual account is in Settings → Data.

## Acceptance checks

- Sentences (`tests/summary.test.ts`): every sentence above, each branch (none, one, many; problems; negative rate; no
  income; filtered; pending counts); `spell`; the greeting's hour boundaries; `reportLead` for every spec; amounts are `money`
  parts (masked) while counts and percentages are not.
- Headings (`tests/ui/headings.test.tsx`): the title and sentence on each page, Home's one-line form, Reports with and without a
  sentence on category pages, Private mode masking amounts but not counts, the line keeping its height while loading.
- Home layout (`tests/home-layout.test.ts`): the default hides Spending and Accounts; a damaged or old-version value falls
  back; unknown and repeated ids dropped, new ids appended shown; toggle, move, `dropIndex`, `moveWidgetTo` and nudge.
- Home (`tests/ui/home.test.tsx`, `tests/ui/private.test.tsx`): hero amount with muted cents; the pill with its percentage and
  `changePhrase`; the range selector (1D to All, 1D opening on an earlier snapshot, Custom applied and cancelled, a pick on Home
  leaving Accounts on its own range); each card's content and empty state and links (including the category rows' addresses); Customize hides and
  reorders and persists; Private mode masks every amount.
- Spending comparison (`tests/home-layout.test.ts`): each mode's slots and labels, the running totals stopping at today,
  the average month ignoring leading empty months, week starts on Sunday.
- The hero chart's bottom margin keeps its line above the 44px the cards overlap (visual check on staging: 1M, 3M, 1Y).
