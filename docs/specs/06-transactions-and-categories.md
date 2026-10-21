# 06 · Transactions and categories

Part of the [specification](README.md). Read [00 · Principles](00-principles.md), [01 · Data contract](01-data-contract.md),
[03 · Connections and sync](03-connections-and-sync.md) and [04 · Accounts and net worth](04-accounts-and-net-worth.md)
first. This spec covers bank and card transactions: how they are downloaded, stored and edited, categories, splits,
transactions you add yourself, the one-off Monarch import, the Transactions page and the category settings. Reports
read the same rows ([07](07-reports.md)).

## Principles specific to transactions

- **Plaid keeps the provider's columns; the owner's edits live in separate columns** (`user_date`, `category_id`,
  `notes`, splits) that **a sync never touches**. Where an edit moves (pending → posted, resent after a reconnect) it
  is carried over, never lost.
- Stored with Plaid's sign: **positive = money out, negative = money in**; the UI shows money in as `+$x`.
- A manual transaction **never changes any account balance or net worth**: balances come from the bank or from the
  balance entered on a manual account.
- Only bank and card accounts (`cash`, `credit`) get transactions from Plaid. **Brokerage activity is not included**
  (a different Plaid endpoint, not implemented). History is about 90 days for connections made before transactions
  were added (it cannot be extended without relinking, which would use a trial Item slot) and up to two years for new
  connections (`days_requested = 730`).

## Data

`transactions` (`004_transactions`, extended by later migrations):

| Column                                            | Meaning                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id` text                                         | `<connection id>:<Plaid transaction_id>`; `manual:<uuid>`; `monarch:<Monarch id>`                               |
| `account_id`                                      | → `accounts`, cascade delete                                                                                    |
| `provider_id`, `source`, `external_id`            | Plaid id; `plaid`, `manual` or `monarch`; the id in the source system (unique per source, for re-import dedupe) |
| `date`, `authorized_date`                         | the provider's posted date, and the authorised date when given                                                  |
| `amount numeric(24,8)`, `currency`                | provider sign; `USD` default                                                                                    |
| `name`, `merchant_name`                           | the statement text, and the merchant when known                                                                 |
| `pending`, `pending_transaction_id`               | pending state; the pending row a posted one replaces                                                            |
| `provider_category`, `provider_category_detailed` | Plaid `personal_finance_category` primary and detailed                                                          |
| `auto_category_key`                               | the `categories.key` derived from them (below), stored so it can be filtered in SQL                             |
| `provenance`                                      | `plaid_<env>`, `manual`, `monarch_import`, `simulated`                                                          |
| `removed_at`                                      | Plaid removed it: hidden, edits kept, comes back if it reappears                                                |
| `user_date`, `category_id`, `notes`               | **the owner's edits** (null = use the provider's / automatic)                                                   |

The **effective date** is `coalesce(user_date, date)`; the **effective category** is the owner's choice, else a
rule's result (`rule_category_id`, see [Rules](#rules)), else the automatic one, else Uncategorized. `connections.transactions_cursor` holds the Plaid sync cursor. Index on the
effective date for the newest-first list.

`categories(id, name, group_name, group_id, emoji, key unique, sort_order)` with a unique lower-case name;
`category_groups(id, type income|expense|transfer, name, sort_order)` unique per `(type, lower(name))`;
`transaction_splits(id, transaction_id cascade, amount, category_id, notes, date, sort_order)`. `group_name` is kept in
step with the group's name by the app so transaction queries need no join.

## Downloading (`syncTransactions`, part of the sync, [03](03-connections-and-sync.md#the-sync-syncall))

After a connection's balances are committed, for connections with bank or card accounts:

1. Call `/transactions/sync` with the saved cursor, 500 per page, `include_personal_finance_category`, until
   `has_more` is false. If Plaid answers `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, start again from the saved
   cursor (at most twice more).
2. `planTransactionChanges` (pure): for every added or modified row on a tracked account, build the provider row
   (name = statement text, else merchant, else "Unnamed transaction"; currency from `iso_currency_code`, else the
   unofficial code, else `USD`; the automatic category below); rows for other accounts are **skipped, never an
   error**. A row with `pending_transaction_id` is a posted replacement: its edits **carry over** from that pending
   row, which is hidden. Removed ids are hidden, unless the same pass re-adds them.
3. **Re-sent after a reconnect.** When accounts were re-matched in this sync ([03](03-connections-and-sync.md#account-re-matching-serverlibaccount-matchts)),
   Plaid may send their recent transactions again under new ids. Pair each new row one-to-one with a saved row of the
   same account, date, amount (two decimals) and name; the saved row's edits and splits carry over and it is hidden.
   Strict on purpose: never pending rows, never rows already saved, never rows dated on or after the account's previous
   sync (they may be genuinely new), never a row without a one-to-one partner (those are saved as new).
4. Save everything **and the new cursor in one database transaction** (the cursor never moves ahead of the data):
   upsert provider columns only; carry over `user_date`, `category_id` and `notes` onto a posted row that has none of
   its own; carry over splits only if the amount did not change; hide removed rows.
5. A failure returns `TRANSACTIONS_<code>` (never touches balances). `PRODUCTS_NOT_SUPPORTED`,
   `ADDITIONAL_CONSENT_REQUIRED`, `PRODUCT_NOT_READY` and `NO_ACCOUNTS` mean "nothing to give yet": quiet, not a failure.

### Automatic categories (`mapProviderCategory`, `server/lib/transactions.ts`)

Order: (1) a statement matching `/\b(automatic payment|autopay|payment - thank|payment thank)/i` →
`credit_card_payment` (card payments often arrive labelled as income or a transfer); (2) Plaid's **detailed** category
if mapped; (3) its **primary**; (4) `uncategorized`.

| Detailed                                         | Key                   | Primary                       | Key                   |
| ------------------------------------------------ | --------------------- | ----------------------------- | --------------------- |
| `INCOME_WAGES`                                   | `paychecks`           | `INCOME`                      | `other_income`        |
| `INCOME_INTEREST_EARNED`                         | `interest`            | `TRANSFER_IN`, `TRANSFER_OUT` | `transfer`            |
| `FOOD_AND_DRINK_GROCERIES`                       | `groceries`           | `LOAN_PAYMENTS`               | `credit_card_payment` |
| `FOOD_AND_DRINK_COFFEE`                          | `coffee_shops`        | `FOOD_AND_DRINK`              | `restaurants`         |
| `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`              | `credit_card_payment` | `GENERAL_MERCHANDISE`         | `shopping`            |
| `RENT_AND_UTILITIES_RENT`                        | `rent`                | `HOME_IMPROVEMENT`            | `home_improvement`    |
| `RENT_AND_UTILITIES_TELEPHONE`                   | `phone`               | `RENT_AND_UTILITIES`          | `utilities`           |
| `GENERAL_SERVICES_INSURANCE`                     | `insurance`           | `TRANSPORTATION`              | `transportation`      |
| `GENERAL_SERVICES_AUTOMOTIVE`                    | `auto_maintenance`    | `TRAVEL`                      | `travel`              |
| `LOAN_PAYMENTS_MORTGAGE_PAYMENT`                 | `mortgage`            | `ENTERTAINMENT`               | `entertainment`       |
| `LOAN_PAYMENTS_CAR_PAYMENT`                      | `auto_payment`        | `PERSONAL_CARE`               | `personal_care`       |
| `GOVERNMENT_AND_NON_PROFIT_DONATIONS`            | `charity`             | `MEDICAL`                     | `medical`             |
| `TRANSPORTATION_GAS`                             | `gas_ev`              | `GOVERNMENT_AND_NON_PROFIT`   | `government`          |
| `TRANSPORTATION_PARKING`, `TRANSPORTATION_TOLLS` | `parking_tolls`       | `GENERAL_SERVICES`            | `services`            |
| `TRANSPORTATION_PUBLIC_TRANSIT`                  | `public_transit`      | `BANK_FEES`                   | `fees`                |
| `TRANSPORTATION_TAXIS_AND_RIDE_SHARES`           | `taxi`                |                               |                       |

Plaid's suggestions are noisy, so the owner's choice always wins. **Every start-up recomputes** `auto_category_key` for
all non-removed Plaid rows from their stored provider fields (`remapAutoCategories`), so a change to the mapping reaches
rows synced earlier; it never touches the owner's own choices.

## Categories

- **Seeded** (stable `key`, so renaming or moving one keeps the mapping): Income (Paychecks, Interest, Other Income,
  Business Income, RSU, ESPP, 401k contribution, HSA, Dividends & Capital Gains), Transfers (Transfer, Credit Card
  Payment), and expense groups Gifts & Donations, Auto & Transport, Housing, Food & Dining, Shopping, Bills &
  Utilities, Travel & Lifestyle, Health, Other (with the categories the table above names, plus Uncategorized,
  Groceries, Restaurants & Bars, and so on; see migrations `004`, `005`, `008`). The income categories for money
  entered by hand are named like Monarch's so a Monarch import reuses them. Names are unique ignoring case.
- **Groups** belong to one type: `income`, `expense` or `transfer`. A type decides how Reports count a category.
- `GET /api/categories` → `{groups, categories}` in display order (income, expense, transfer; then group order, then
  category order), each category with its group, type, key and `transaction_count`: an unsplit transaction counts once,
  a split one once per part.
- `POST /api/categories` `{name ≤ 60, group_id, emoji?}`; `PATCH /api/categories/:id` (`name`, `emoji`, `group_id`);
  `DELETE /api/categories/:id`: its transactions return to their automatic category; **Uncategorized is the fallback
  and cannot be deleted**.
- `POST /api/category-groups` `{type, name ≤ 40}`; `PATCH` renames (and updates `group_name` of its categories in the
  same transaction); `DELETE` only an **empty** group ("Move or delete the categories in this group first").
- A duplicate name answers "A category|group with that name already exists"; unknown ids 404.
- **The icon picker is built in (no network)**: tabs of emoji, search by name, or paste any emoji (`src/lib/emojis.ts`).

## Rules

`014_rules`: `rules(id, sort_order, conditions jsonb, category_id → categories ON DELETE RESTRICT, last_applied_at,
last_applied_count)` and on `transactions`: `rule_id` (→ rules, set null on delete) and `rule_category_id`. A rule's
result is kept apart from the owner's own choice (`category_id`) and from the automatic one, so **the order is: your
edit, then a rule, then the automatic category, then Uncategorized**. `category_source` is `user`, `rule`, `auto` or
`none`. Every query that works out the effective category (the list, category counts, report lines) includes the rule.

- **Conditions** (`conditions`, all that are present must match; at least one): `merchant` and `statement` (the merchant
  name, else the statement text; the statement text) with `contains`, `equals` or `starts_with` against one or more
  values (any one matches), ignoring case; `amount` with a direction (`debit` = money out, `credit` = money in), an
  operator (`gt`, `lt`, `eq`, `between`) and dollars compared as decimals on the absolute amount; `categories` (the
  current category is one of them); `accounts`. **Action:** set the category (`category_id`).
- **Order.** Rules run top to bottom; each sees the category the ones above left (so a `categories` condition can chain),
  and the **last match wins**. Pure code: `server/lib/rules.ts` (`matchesConditions`, `resolveRules`).
- **Never touched by a rule:** a transaction with the owner's own category, a split one (each part has its own category)
  or one added by hand. A rule never overwrites a choice of yours.
- **When rules run:** (1) on every sync, for the rows the sync saved, inside the sync's own database transaction behind a
  savepoint (a rule problem is logged and never costs the sync its data); a row that stops matching loses its rule
  result; (2) on **Update existing transactions**, only for the one rule, and only for the rows its preview listed.
  Editing or reordering a rule never changes old transactions by itself.
- **API:** `GET /api/rules`; `POST /api/rules` and `PATCH /api/rules/:id` with `{conditions, category_id, apply?}`
  (`apply: true` also updates existing transactions and answers `updated`); `POST /api/rules/preview`
  `{conditions, category_id, rule_id?}` → `{matching, skipped: {edited, split}, total, changes[≤200]}` where each change
  is `{id, date, merchant, account, amount, from, to}` (nothing is written); `POST /api/rules/:id/apply` →
  `{updated}`; `POST /api/rules/order` `{ids}` (every rule once); `DELETE /api/rules/:id?revert=true|false` (`revert`
  puts the transactions the rule categorised back to automatic). Unknown categories or accounts are refused; a category
  used as a rule's action cannot be deleted ("change or delete the rule first").
- **Settings → Rules** (`/settings/rules`): the count, search, **Create rule**, the rules as sentences ("If merchant name
  contains vmware → Recategorize to Paychecks") with a last-applied line, drag handles and up/down buttons for the order.
  The editor has **Settings** and **Preview changes (n)** tabs, the matching count (and how many matches were skipped as
  yours or split), **Update existing transactions**, Delete (offering to revert) and Save.
- Not built yet: renaming the merchant, tags, owner, review status, hide, goals, a rule from the transaction drawer,
  suggestions from repeated edits.

## Reading and editing

`GET /api/transactions?from&to&account&accounts&category&categories&merchant&type&q&limit&cursor` → `{transactions,
nextCursor, total?}`, newest effective date first (ties by id), `limit` 1-500 (default 100), `cursor` an opaque
base64url of the last `date|id`.

- `from`/`to` (calendar days): a split transaction is in range when the transaction **or any part** is.
- `accounts` and `categories` are comma lists. A category filter matches an unsplit transaction's effective category
  or any category its parts use. `merchant` compares the merchant name (else the statement text) ignoring case, and the
  response then also carries `total`, the count ignoring paging. `type=income|expense` keeps transactions with a part
  that counts as income or spending in Reports (by the category's group type; Uncategorized by direction); pending rows
  are never counted there, so they are not listed. `q` searches name, merchant, notes and part notes (case-insensitive,
  `%` and `_` escaped).
- Each row: id, account (name, mask, institution, included), effective `date`, `provider_date`, `user_date`, amount,
  currency, name, merchant, pending, notes, source, `category` (`{id, name, emoji, group}`) with `category_source`
  (`user`, `auto`, `none`), `splits` (id, amount, notes, date or null, category) and `split_balanced`.

`PATCH /api/transactions/:id` (strict body; at least one field):

- `date` (null clears; not more than a year ahead), `category_id` (null = automatic), `notes` (≤ 2000): any
  transaction. For a bank row `date` sets `user_date` (the bank's date is kept; "Reset to bank date" sends null).
- `name` (≤ 200), `amount` (a positive amount, at most 2 decimals, with `direction` `in`|`out`) and `account_id`: **only
  a transaction you added yourself** ("Only a transaction you added yourself can have its name, amount or account
  changed"). A manual transaction's date is its own `date` and cannot be cleared.
- A **pending transaction is read-only** (409): it is replaced by the bank when it posts. Unknown category or account
  is refused.

`POST /api/transactions` `{account_id, date, amount, direction, name, category_id?, notes?}` creates a manual one
(`source manual`, `manual:<uuid>`, money in stored negative, currency from the account); `DELETE /api/transactions/:id`
works **only on manual ones**. Bank and imported transactions can never be deleted or have their amount changed.

### Splits

`PUT /api/transactions/:id/splits` `{splits: [{amount, category_id|null, notes, date?}]}` replaces all parts;
`DELETE …/splits` removes them. Rules (`splitProblem`): 2 to 20 parts; every part non-zero and with the **parent's
sign** (money in splits into money in); the parts **add up to the parent's amount exactly** (cents), with a message
stating the sum otherwise; a part's `date` (null = the transaction's) is not more than a year ahead; unknown category
refused; not for pending rows. The list shows the parent with its parts under it; the **day total counts the amount
once**. **Split evenly into N** fills equal parts (leftover cents to the first parts) and can space the dates one per
week or month. If the bank later changes the amount the split is flagged "Amount changed" (`split_balanced = false`)
until adjusted; when a pending transaction posts its split moves if the amount is unchanged. Splitting is off in
Private mode.

## Monarch import (one-off; `POST /api/transactions/import-monarch` `{csv, commit}`)

For bank and card accounts only (Monarch's 401(k)s, IRA, HSA, brokerage and Apple accounts are listed and skipped).
**Sync Plaid first.** Nothing is saved until the owner confirms the summary; `commit: false` is a dry run.

- **Parse** (`parseMonarchCsv`, RFC 4180 with quoted fields, CRLF and a BOM): columns `Date, Merchant, Category,
Account, Original Statement, Notes, Amount, Id` are required (else "This does not look like a Monarch export"); at
  most 20,000 rows; a row with a bad date, amount, missing id (≤ 100 characters) or account, or a wrong cell count is
  counted by **line number only** and never reported in content. **Monarch's sign is the opposite of Plaid's**: the
  amount is negated on read. The CSV text is never logged.
- **Accounts** are matched by the **last four digits** in Monarch's account name (`Rewards Card (...1111)` → the bank
  or card account whose mask is 1111), never by name. An account with no digits, no matching local account, or two
  local accounts ending alike is skipped and shown with the reason.
- **Plaid keeps everything, Monarch fills in**, per account: a Monarch row dated before Plaid's first transaction
  (minus 3 days) is **added** (marked imported, `monarch_import`); inside that window it is matched one-to-one to a
  Plaid row with the same amount and a date within 3 days, and a match only **donates its category and notes where the
  owner has not set their own**; an unmatched row inside the window is left out to avoid duplicates. Future-dated and
  unreadable rows are skipped. A pending row is never filled in.
- **Categories**: names are matched to the owner's ignoring case; unknown ones are created in a group **Imported from
  Monarch** (under Income if every row was money in, else Expenses).
- **Safe to repeat**: each row keeps its Monarch id (`monarch:<id>`, unique per source), so importing the same or a
  newer export again adds only new rows. The summary (counts and a per-account table, never the transactions) is shown
  before committing. The commit is **one database transaction**, refused while a sync runs (takes the sync lock;
  "A sync is running. Try the import again in a minute."), rows inserted in batches of 1,000.

## Transactions page (`/transactions`)

Mockups: [`docs/design/zen/`](../design/zen/) (Transactions, Transaction detail). The content is the contract:

- A long merchant name is cut short with an ellipsis; the tags (Pending, Manual) and the amount keep their width, so a
  row never makes the page wider than the screen (the same on Home's Recent transactions).
- Newest first, **each day in its own card** under a heading with the day's net total (money in `+`, in green); infinite
  paging by cursor. Private mode masks amounts.
- **Filters** in a column beside the list: search; **When** (All time, this or last month, this or last year, or **Custom range**: From and To days, each a calendar field; moving one past the other moves the other, so the range is always valid);
  **Accounts** (grouped by bank, several can be picked, "All accounts" clears); **Categories** (chips, several, grouped as
  in Settings). On a phone they fold behind a **Filters** button that counts what is picked.
- Clicking a row opens the **detail**: beside the list on a wide screen (1280px and up), over the page otherwise, a
  sheet rising from the bottom on a phone: category, date (a calendar, nothing typed), notes, split, delete (own
  entries only), "Reset to bank date", and a merchant link "View N transactions" (the merchant report, [07](07-reports.md)).
  Pending rows show their values with a note that they cannot be edited yet.
- **Add transaction**: a button on the page (a round button above the tab bar on a phone): Money in / Money out, any
  account (including investment accounts; a link adds a manual account), date, amount, description, category, notes.
  Marked **Manual** in the list. Not available in Private mode.
- Category settings (**Settings → Categories**): Income, Expenses and Transfers, each with groups holding categories;
  click a category to change icon, name or group, or delete it; **Create Category** under a group; **Create group**;
  **Edit** a group's name; categories created by the owner carry a **Custom** tag.

## Staging data

Staging seeds about 110 fake transactions on the demo accounts, plus about 22 months of fake monthly history before
them (paychecks, rent, groceries, card payments, transfers, refunds, an uncategorised deposit and one purchase split
across two months), once, so Reports has a trend; Sandbox Items also receive Plaid's test transactions. Production is
never seeded.

## Not built yet: brokerage activity

Plaid's bank endpoint returns nothing for brokerage accounts; `/investments/transactions/get` works (tested with one
brokerage: about a month, across several accounts). Rows carry type and subtype (buy, sell, dividend, transfer,
deposit), quantity, price, fees and the security. Quirks to design for: the sign is positive for money out (a buy is
`+`, a dividend, sale or deposit is `−`); share moves between accounts (lapses, transfers) have `amount = 0` and look
like duplicates; cash rows use the security `CUR:USD`; there is no Plaid category, no merchant and no sync cursor
(date range and offset paging only); "Journal to/from …" rows appear on both accounts and can be paired. It needs its
own type-aware display and sign handling, so it is a separate feature.

## Acceptance checks

- Category mapping: every row of the table above, the card-payment regex beating a provider "income", detailed before
  primary, unknown → `uncategorized`; the start-up remap changes only automatic categories (`tests/transactions.test.ts`).
- `planTransactionChanges`: tracked-account filtering and skips, id prefixing, pending → posted carry-over, a row
  both modified and removed ends removed unless re-added, name fallbacks (`tests/transactions.test.ts`).
- Re-sent rows: paired only one-to-one on account, date, amount and name; never pending, already-saved, or rows dated on
  or after the previous sync; unpaired rows are new (`tests/resent-transactions.test.ts`).
- Splits: sign rules, exact sum, 2-20 parts, zero parts refused, even split cents, part dates, balance flag
  (`tests/splits.test.ts`, `tests/transactions.test.ts`).
- Sync invariants (integration): the cursor and data are saved together; a transactions failure leaves balances; user
  date, category, notes and splits survive a sync, a pending → posted change and a removal followed by a re-add; a
  pending row cannot be edited (409); only manual transactions can be deleted or have amount, name or account changed.
- Filters: date range matches a split transaction by any part; category filter matches parts; `type` follows Reports;
  `merchant` returns `total`; cursor paging is stable; a bad cursor or filter is refused (integration).
- Categories: Uncategorized cannot be deleted; deleting a category returns rows to automatic; a non-empty group cannot be
  deleted; duplicate names are refused; counts treat splits per part (integration).
- Rules (`tests/rules.test.ts`, `tests/rules-ui.test.ts`, integration): case-insensitive text matching with any value, amount
  direction and size with the bank sign, every condition required and an empty rule matching nothing, order with the last
  match winning and chained categories, bodies refused; a preview writes nothing; applying changes exactly what was
  previewed; your own category beats a rule and clearing it brings the rule back; sync gives new rows their rule result
  and a row that stops matching loses it; reorder needs every id; a rule's category cannot be deleted; deleting with
  revert puts rows back to automatic.
- Monarch (`tests/monarch.test.ts`, integration): CSV edge cases (quotes, CRLF, BOM, unreadable lines by number only), sign
  flip, last-four matching with skips and reasons, the before-window / inside-window rules, one-to-one matching within 3
  days, edits never overwritten, unknown categories created in the Imported group, a repeat import adds nothing, the
  dry run writes nothing, commit refused during a sync.
- UI (`tests/ui/transactions.test.tsx`, `tests/ui/monarch.test.tsx`, `tests/ui/private.test.tsx`): day cards and totals,
  filters (and the phone fold), the detail in its three placements, editing, split editor, add transaction, Manual tag,
  Private mode masking and disabling.
