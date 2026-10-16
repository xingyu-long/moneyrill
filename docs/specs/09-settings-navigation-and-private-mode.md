# 09 · Settings, navigation, addresses and Private mode

Part of the [specification](README.md). Read [00 · Principles](00-principles.md) (privacy, the Zen look),
[02 · Foundation](02-foundation.md) (sign-in) and the feature specs first. This spec covers how the owner moves around
(addresses, the top bar, the phone tab bar), Settings and its pages, the JSON archive and CSV, **Private mode** and the
choices kept on a device.

## Addresses (`src/lib/routes.ts`, `src/state/router.ts`)

**The address bar is the source of truth for the page.** A plain click on an in-app link pushes a history entry without a
reload (Back, Forward, reload and bookmarks work; a modified click opens a new tab). The server answers any address outside
`/api` with the app ([02](02-foundation.md#the-http-shell-serverappts)). **Addresses hold page names, dates and ids only,
never amounts** (they end up in browser history). The same names are meant to be reused for deep links if an iOS app is built.

| Address                                                                                                                                    | Page                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `/home` (also `/`)                                                                                                                         | Home; an unknown first segment is replaced by `/home` (no extra Back step) |
| `/accounts`, `/accounts/<id>`                                                                                                              | Accounts; one account (id URL-encoded)                                     |
| `/investments`, `/transactions`                                                                                                            | those pages                                                                |
| `/reports/cash-flow`, `/reports/spending`, `/reports/income`, `/reports/category/<id>`, `/reports/merchant/<name>`                         | Reports ([07](07-reports.md#addresses))                                    |
| `/settings`, `/settings/connections`, `/settings/data`, `/settings/categories`, `/settings/sync`, `/settings/display`, `/settings/sign-in` | Settings                                                                   |

A tab is found by its lower-case name as the first segment (`TABS`: Home, Accounts, Investments, Transactions, Reports,
Settings); a path that names no tab (and is not `/`) is replaced by `/home`. Opening **Reports** from the bar returns to the
last report page (Cash flow, Spending or Income) used on this device, always over its default range.

## The top bar (`Topbar`, `MainNav`)

One navigation, three looks:

- **Above 1000px**: a sticky bar (blurred background) with the wordmark `money`+italic sage `rill` at the left linking to
  Home; in the middle a **pill of page names** (Home, Accounts, Investments, Transactions, Reports) with the current page
  filled (primary colour, `aria-current="page"`); at the right a **Sign out** button (only when sign-in is required), the
  **environment badge** (`STAGING` in warning colour; production has none and shows a round **Sync accounts** button in its
  place, disabled with no active connection), a round
  **Search** button, the round **Private mode** button, and **Settings as a round gear button** at the far right.
  The search button opens Transactions and focuses its search box once drawn (it may still be loading, so it retries for up
  to 1.5 s); navigating clears the search text.
- **761-1000px**: the same pill shows icons only (names stay for screen readers).
- **Phone (760px and below)**: the top bar scrolls away and the pages float in a **pill tab bar at the bottom** (clear of
  the home indicator): icons, and the **open page widens to show its name**; pages not in the bar are under **More** (a menu
  above the bar). Search is hidden (use the Transactions page's own box).

## The phone tab bar choice (`src/lib/navigation.ts`)

Home is always first; the owner chooses up to **four more** pages (`BAR_MAX = 5` including Home), in order. Default: Accounts,
Investments, Transactions, Reports. Settings may be added like any page. A saved value is valid only if it is a list of at most
four distinct known tabs, none of them Home; otherwise the default is used. Helpers: `barTabs`, `moreTabs` (the rest, in the
top bar's order), `move` (swap with a neighbour), `addToBar` (to the end; nothing if full or present), `removeFromBar`.
Stored on this device under `moneyrill.tabbar`. The top bar on a computer always lists every page.

## Settings (`/settings`)

A list of six pages, each its own address. On a computer the list sits beside the page (a sticky 250px column; **Connections**
when none is chosen) with a small "Yours to keep." card and the environment name below it. On a phone `/settings` is the
list alone (each row an icon, label and chevron) and a page opens **full screen with a back arrow** and its title. A page's
header uses the page sentence ([08](08-home-and-headings.md#page-headings-srccomponentspageheadingtsx-srclibsummaryts)).

1. **Connections** (title "Connections" in production, "Sandbox connections" in staging): one card per connection
   ([03](03-connections-and-sync.md#pages)); **Add an account** (starts Plaid Link, disabled without Plaid keys, with a note
   that manual accounts remain available), **Sync connected accounts** (disabled with no active connection), and in staging
   **Load sandbox samples**. Disconnect asks first ([03](03-connections-and-sync.md#disconnect)).
2. **Data**:
   - **Your data travels with you**: _Download JSON archive_ (`GET /api/export`), _Download accounts CSV_
     (`GET /api/export.csv`), _Import JSON archive_, _Add manual account_ (unavailable in Private mode, [04](04-accounts-and-net-worth.md#manual-accounts)),
     with the note "Imports are merged into your accounts. Re-imports of the same archive are deduplicated. Back up the
     PostgreSQL volume and token key separately for full recovery."
   - **Import from Monarch** ([06](06-transactions-and-categories.md#monarch-import-one-off-post-apitransactionsimport-monarch-csv-commit)).
3. **Categories** ([06](06-transactions-and-categories.md#categories)).
4. **Sync settings & activity**: the schedule and the latest runs ([03](03-connections-and-sync.md#schedule-and-the-worker)).
5. **Display and navigation**: **Appearance** (a segmented choice, Match device / Light / Dark), **Home** (the **Customize Home**
   button, [08](08-home-and-headings.md#customize-home-settings--display-and-navigation--customize-home-also-reachable-from-an-empty-home)),
   and **Edit navigation** (the tab bar list: "N of 5", Home locked, move earlier / later, remove, and add from the remaining
   pages; add is disabled when full).
6. **Sign-in** (`/settings/sign-in`, key icon): with a passphrase, **Change passphrase**: _Current passphrase_, _New
   passphrase_ (12+ characters) and _Repeat the passphrase_. The button is enabled only when the current one is filled and the
   new one is long enough and matches; the server's error shows in the alert (a wrong current passphrase, the lockout); on
   success the fields clear and it says "Passphrase changed. Other devices were signed out." while this browser stays
   signed in. With no passphrase yet (the app is open on this computer), **Set a passphrase**: new and repeat; afterwards
   the app asks for it ([02](02-foundation.md#sign-in)).

Settings keeps its own Sync and Add an account buttons. The top bar's Sync button is production only; the Accounts page's
Add an account is the only Add account button outside Settings (see [08](08-home-and-headings.md)).

## Archive and CSV (`server/services/archive.ts`, `server/routes/archive.ts`)

- **Export** `GET /api/export` → `{version: 1, exportedAt, environment, tables}` with `tables` = accounts, balance_snapshots,
  securities, holding_snapshots, benchmark_observations, categories, transactions, transaction_splits; `connection_id` and
  `provider_id` are removed from every row (**provider credentials are never included**). Download name
  `moneyrill-archive.json`. `GET /api/export.csv` → `name,institution,kind,currency,balance,source` per account, every cell
  quoted, a cell that starts like a formula prefixed with `'`.
- **Import** `POST /api/import` (client checks: at most 12 MB, `version: 1`, `tables.accounts` an array): validated with zod; in
  production only a production archive, and **no row with source or provenance `simulated`/`plaid_sandbox`**
  ([02](02-foundation.md#deliverables)); at most 500 accounts, 300,000 balances and 300,000 holdings. Everything in one
  transaction: accounts get the id `import:<id>` (source `imported`; `included` kept), securities `import:<id>`, balances and
  holdings are inserted with `ON CONFLICT DO NOTHING` (provenance `imported`, or `simulated` if it was), benchmarks likewise;
  then net worth is recomputed. **Re-importing the same archive adds nothing.** The import does **not** read categories or
  transactions yet (they are exported only). The CSV and JSON exports contain real values even in Private mode; Investments
  and Reports have their own CSV downloads ([05](05-investments.md#investments-page-investments), [07](07-reports.md#pages)).
- Backups of the whole database are a separate operation ([`development/OPERATIONS.md`](../development/OPERATIONS.md)).

## Private mode

A round eye button on the top bar of every page (on a phone it is in the bar that scrolls with the page); it toggles
`aria-pressed` and shows "Private mode on". It is remembered **on this device only** (`moneyrill.private`, `1` or `0`), read
once at start, and a value under the app's earlier name is still read.

- **Hidden:** every dollar amount and share count: net worth, balances, holdings values, cost basis, quantities, chart dollar
  axes and tooltips, report amounts, amounts inside summary sentences; amounts become the mask `••••••` (the hero shows it at
  a smaller size). Implemented once, in the formatting helpers (`cash`, `cashWhole`, `price`, quantities all consult the
  mode), set **before** re-rendering so every formatter sees it.
- **Visible:** growth and return percentages, weights, counts and each security's public price. Unrealised gain shows as a
  percentage instead of dollars; the pill under net worth shows the change in percent.
- **Disabled while on** because they need the amounts: editing a manual balance, splitting a transaction, adding a
  transaction, adding a manual account.
- It hides what is on screen. **Exports (CSV, JSON) and addresses are unaffected**: exports contain real values; addresses
  never held amounts.

## Theme and appearance

`moneyrill.theme`: `light` or `dark` (absent = follow the device). `applyTheme` sets `data-theme` on the root and the browser
`theme-color` from the `--page` variable (so the two cannot drift); an inline script in `index.html` applies the saved choice
before first paint. Zen night (dark) is the default look; tokens in [00](00-principles.md#look-and-feel-zen).

## The sign-in page

Shown instead of the app when sign-in is required and there is no session ([02](02-foundation.md#sign-in)): the same Zen look,
a passphrase field, the error text from the server (including the lockout message), and the version line
(`v <commit> · built <time>`). When no passphrase exists (`status.configured` false) it shows **Create a passphrase**
instead: **New passphrase** (12+ characters) and **Repeat the passphrase**. The button is enabled only when the
passphrase is long enough and both match; the server's error shows in the alert. On success the app loads signed in.
Once a passphrase exists no device ever sees this form ([02](02-foundation.md#sign-in)).

## Choices kept on a device

| Key                     | Holds                         | Notes                                          |
| ----------------------- | ----------------------------- | ---------------------------------------------- |
| `moneyrill.theme`       | `light` \| `dark`             | absent = match the device                      |
| `moneyrill.private`     | `1` \| `0`                    | Private mode                                   |
| `moneyrill.home`        | `{order, hidden, compare, v}` | Customize Home ([08](08-home-and-headings.md)) |
| `moneyrill.tabbar`      | list of up to 4 tab names     | phone tab bar                                  |
| `moneyrill.reports.url` | the last report page          | only the page, never a range or filter         |

Every read and write is wrapped so an unavailable storage (private browsing) never breaks the page; the earlier names
(`stillwater.*`) are still read for `private` and the last report. Nothing here carries amounts, and none of it is sent to
the server.

## Acceptance checks

- Routes (`tests/routes.test.ts`): `tabOf`, `isKnownPath`, `accountIdOf` (encoded ids, bad escapes), `settingsPageOf`; every
  Reports address round-trips; unknown paths are replaced by `/home`.
- Navigation (`tests/navigation.test.ts`): `parseBar` rejects too many, duplicates, Home and unknown tabs and falls back to the
  default; `move`, `addToBar` (full and duplicate), `removeFromBar`, `moreTabs` order.
- UI (`tests/ui/topbar.test.tsx`, `tests/ui/routing.test.tsx`, `tests/ui/phone-layout.test.tsx`, `tests/ui/settings-nav.test.tsx`):
  the pill, the gear, Sign out only when required, the environment badge (staging) or the Sync accounts button (production), search focusing Transactions; Back and Forward;
  the phone bar widening, More, the settings list and back arrow; Edit navigation add, remove, move and the limit.
- Private mode (`tests/ui/private.test.tsx`): amounts and share counts masked everywhere listed, percentages and public prices
  visible, the four actions disabled, the choice persisted and an old key read, no amount ever in an address.
- Archive (`tests/integration.ts`): credentials omitted from export; re-import deduplicates; a malformed archive rolls back
  entirely; production refuses sandbox or simulated rows and a staging archive; the size limits; CSV formula cells prefixed.
- Theme (`tests/theme.test.ts`): every variable is set in both blocks and no hex colour appears outside `src/theme.css`.
- Login (`tests/ui/login.test.tsx`): error and lockout messages shown, the field cleared after sign-in.
