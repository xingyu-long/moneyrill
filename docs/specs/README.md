# Moneyrill specification

What Moneyrill does and the rules it must keep, written so that a person or a coding agent can rebuild it, or
extend it, from an empty repository. It replaces the scattered feature notes and plans: **one place per feature**.

## How to use it

1. Read [00 · Principles](00-principles.md) (money, privacy, security, the Zen look) and
   [01 · Data contract](01-data-contract.md) (what Plaid sends and how it is stored).
2. Build the features in the order below. Each spec ends with **acceptance checks**; do not start the next feature
   before they pass.
3. Follow [`CLAUDE.md`](../../CLAUDE.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the workflow, and
   [`docs/development/`](../development/DEVELOPMENT.md) for the code layout, checks and how to run each environment.

## Fidelity: what is pinned and what is not

| Pinned (build exactly this) | Left to the builder |
| ----------------------------------------------------------------------------------- |
| Data model and migrations, API paths, request and response shapes | File and component names, internal structure |
| Calculations and sign conventions (net worth, return, reports, splits) | Library choices that keep the principles above |
| Invariants (excluded accounts never count, edits win over sync, a failure is local) | Exact pixel layout and spacing (see mockups) |
| Design tokens, type, shape and copy rules in [00](00-principles.md) | Wording of labels the spec does not quote |
| Acceptance checks | Test file layout (the invariants must be tested) |

## Build order

The order follows the dependencies; each spec lists what it covers and ends with acceptance checks.

| #   | Spec                                                                                | Covers                                                                                           |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 00  | [Principles](00-principles.md)                                                      | Stack, money, privacy, security, database rules, Zen design                                      |
| 01  | [Data contract](01-data-contract.md)                                                | Plaid account, holding and transaction formats, Item lifecycle, price and manual-holding storage |
| 02  | [Foundation](02-foundation.md)                                                      | Project skeleton, config, Docker, migrations, sign-in and sessions, demo seed                    |
| 03  | [Connections and sync](03-connections-and-sync.md)                                  | Plaid Link, Reconnect, tokens at rest, sync worker and schedule, account matching                |
| 04  | [Accounts and net worth](04-accounts-and-net-worth.md)                              | Account list and page, manual accounts, snapshots, net worth and its history                     |
| 05  | [Investments](05-investments.md)                                                    | Holdings, allocation, security detail, prices, typed-in holdings, portfolio return, benchmarks   |
| 06  | [Transactions and categories](06-transactions-and-categories.md)                    | List, filters, drawer, edits, splits, manual entries, categories, Monarch import                 |
| 07  | [Reports](07-reports.md)                                                            | Cash flow, Spending, Income, category and merchant pages, date range and filters                 |
| 08  | [Home, headings and summary sentences](08-home-and-headings.md)                     | Net worth hero, cards, Customize Home, page titles and sentences                                 |
| 09  | [Settings, navigation and Private mode](09-settings-navigation-and-private-mode.md) | Settings pages, top bar and phone tab bar, Display options, import and export                    |
| 10  | [Operations and release](10-operations-and-release.md)                              | Environments, backups, rollback, the ship flow                                                   |

The list may be adjusted when a feature is added (add its spec here and keep the order consistent with the dependencies).

## Keeping the docs in sync

The spec is only useful while it matches the app. **Whenever a feature is added or a behaviour changes in a big way,
update the docs in the same pull request**: the feature's spec here (behaviour, data model, API, invariants,
acceptance checks), the specs index if the build order or status changes, `README.md` (features, configuration),
`docs/development/` (commands, environments), `TODO.md` and `CHANGELOG.md`. A change that touches a pinned item in the
fidelity table above (a table, an endpoint, a calculation, an invariant, a design token) always updates its spec. A
pull request that changes behaviour and leaves its spec stale is not finished; say in the description which docs you
updated, or why none needed it.

## Related

- Design mockups: [`docs/design/zen/`](../design/zen/)
- Day-to-day development: [`docs/development/`](../development/DEVELOPMENT.md)
- What is next: [`TODO.md`](../../TODO.md)
