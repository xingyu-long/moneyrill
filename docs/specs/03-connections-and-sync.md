# 03 · Connections and sync

Part of the [specification](README.md). Read [00 · Principles](00-principles.md), [01 · Data contract](01-data-contract.md)
and [02 · Foundation](02-foundation.md) first. This spec covers how a bank or brokerage login becomes saved accounts
and balances: Plaid Link, Reconnect, Disconnect, token storage, the sync that refreshes everything, and the schedule
that runs it. Transactions are downloaded by the same sync but specified in [06](06-transactions-and-categories.md); holdings
and prices in [05](05-investments.md).

## Concepts

- A **connection** is one Plaid Item: one login at one institution, possibly with several accounts. Table
  `connections` ([02](02-foundation.md#database)). `products` is a JSON list of `transactions` and/or `investments`.
- The Plaid **access token** is saved encrypted; the browser never sees it. The browser only gets public connection
  summaries (`/api/overview` → `connections`: id, institution, products, environment, disconnected_at, last_synced,
  last_error, consent_expires_at, created_at).
- Staging uses Plaid Sandbox, production uses Plaid Production; the two never share a database, key or identifier
  namespace ([02](02-foundation.md#database)). The app runs no Plaid service for you: the owner brings their own keys.
  A connection created in production may create a billed or trial Item that cannot be given back, so nothing creates
  one without the owner choosing **Add an account**; **Reconnect** reuses the Item.

## Token encryption (`server/services/token-crypto.ts`)

AES-256-GCM. The key is a 64-hex-character file (`KEY_FILE`, default `secrets/token.key`, created by
`./scripts/setup.sh`, never committed). Stored value = base64(12-byte IV ‖ 16-byte auth tag ‖ ciphertext). A missing,
unreadable or malformed key is reported at startup with what to do and throws only when a token is actually used.
A database backup alone cannot decrypt connections; the key is backed up separately.

## Add an account (one Link flow for banks and brokerages)

1. `POST /api/link` `{connectionId?}` → `{link_token, products, connectionId}`.
   - **New:** `products: ['transactions']`, `additional_consented_products: ['investments']` (investment consent
     without requiring every bank to support it), `transactions.days_requested = 730`, `client_name: 'Moneyrill'`,
     `user.client_user_id = local-<APP_ENV>`, `country_codes: ['US']`, `language: 'en'`, plus `redirect_uri` when
     `PLAID_REDIRECT_URI` is set.
   - **Reconnect** (`connectionId` given; the connection must be active in this environment): the saved access token
     with `update.account_selection_enabled: true`, no products, no new token exchange. Account selection is on so
     the owner can add or remove accounts.
2. The browser opens Plaid Link (`react-plaid-link`; script and frame from `cdn.plaid.com`). For redirect (OAuth)
   institutions the page resumes the flow from a tab-scoped session; the redirect must return to the same origin.
3. `POST /api/exchange` `{public_token}` → exchange the public token (`assertTokenEnvironment(token, 'public')`),
   **save the encrypted access token immediately** (a later metadata failure never loses it), set `products` from the
   accounts returned (`investments` only if an investment account exists), best-effort fetch the institution name and
   consent expiry, then run a full sync and return its result. The UI says "connected" only after this saved.
   An exchange failure is logged (`link.exchange_failed`, the code only) and returned as the error.
4. Connections are keyed by Plaid `item_id` (upsert; saving an existing Item clears `disconnected_at`).

`server/adopt-item.ts` can adopt an existing Item: it reads an access token from stdin (never an argument), checks it
belongs to this environment and that `item_id` matches when given, and stores it re-encrypted. Sharing an Item with
another app means disconnecting it in either invalidates it in both.

## Disconnect

`POST /api/connections/:id/disconnect`: under the sync advisory lock, call Plaid `/item/remove` (ignore
`ITEM_NOT_FOUND` and `INVALID_ACCESS_TOKEN`, fail on anything else), then set `disconnected_at`, clear the stored token,
clear `last_error`, and mark the connection's accounts `last_error = 'DISCONNECTED'`. **Saved balances and history are
kept.** Disconnecting twice says "Already disconnected". It does not give back a Plaid trial slot, and the owner may
exclude the saved account from net worth afterwards ([04](04-accounts-and-net-worth.md)).

## The sync (`syncAll`)

`POST /api/sync` (also run by the worker). One sync at a time: it takes the advisory lock `931877` with
`pg_try_advisory_lock`; if busy it returns `{status: 'busy', message: 'A sync is already running'}` and does nothing.
It inserts a `sync_runs` row (`running`), then for **each active connection of this environment**:

1. Decrypt the token and assert it belongs to this environment. Fetch `/accounts/get`; if the connection has
   `investments` and an investment account is present, also fetch `/investments/holdings/get` (its accounts replace
   the list).
2. In **one database transaction** for that connection:
   - **Re-match** accounts Plaid gave a new id (below).
   - **Upsert accounts** from Plaid's list. Local id = the saved id for that `provider_id`, else
     `<connection id>:<provider account id>`. Only Plaid types `depository` (kind `cash`), `credit`, `loan` and
     `investment` are kept; others are ignored. Name, institution, mask, currency (`iso_currency_code`, else
     `UNKNOWN`), `source = plaid_<env>`, `last_synced = now()`, `provider_as_of` (Plaid's
     `last_updated_datetime`) are updated; `included` is **not** touched.
   - **Upsert today's balance snapshot** per account (`(account_id, date)` unique, UTC day): `current_balance`
     from Plaid, `holdings_adjustment = 0`, provenance `plaid_<env>`; the trigger records the observation.
   - **Holdings** (when fetched): upsert securities (`<connection id>:<security_id>`; asset class Cash for
     cash-equivalents, Bonds for fixed income, Equities for equity, else the Plaid type or Other); for each investment
     account delete that day's `holding_snapshots` and set `holdings_as_of = today`; insert the returned holdings
     (quantity, institution price, institution value, cost basis).
   - **Exclude unreturned accounts**: a saved account of this connection that Plaid no longer returns gets
     `included = false` and `last_error = 'ACCOUNT_NOT_RETURNED'`, only the first time (so a later manual re-include
     sticks); if Plaid returns it again the upsert restores it. History is never deleted.
   - Set `connections.last_synced = now()`, clear `last_error`, then `recompute` the daily net worth
     ([04](04-accounts-and-net-worth.md#net-worth)); commit. On any error roll the whole connection back.
3. **After** that commit, separately and best-effort: download transactions
   ([06](06-transactions-and-categories.md); a failure adds `TRANSACTIONS_<code>` to the message and never undoes balances),
   then refresh institution name and consent expiry.
4. A connection-level failure records `code = Plaid error_code or SYNC_FAILED` on the connection and its accounts
   (`last_error`), logs it (`sync.connection_failed` with the connection id, institution and code, never amounts),
   and **the other connections still run**. Failed syncs keep the prior data.

After the connections, if `MARKET_DATA` is on: refresh benchmarks, refresh ticker prices, then value holdings at those
closes ([05](05-investments.md)). All best effort; a failed benchmark download adds `BENCHMARKS_FAILED`.

The run ends with `status`: `partial` if anything failed, `success` if there were connections, `idle` if none;
`message` = `"<n> connections updated"` plus `"; <codes>"`; `finished_at` set. The lock is always released.

### Account re-matching (`server/lib/account-match.ts`)

Plaid gives an account a new id when it is removed and added back (e.g. via Reconnect). Keep the saved account (its
history, transactions and settings) when **exactly one** saved account that Plaid no longer returns has the same
trimmed lowercase name, last digits, kind and currency as exactly one returned account with an unseen id, and **both
have last digits** (a wrong merge mixes two accounts' history; a missed one only leaves a duplicate). The saved
account's `provider_id` is updated to the new id; otherwise a new account is created. In that same sync Plaid may
resend the account's recent transactions under new ids: [06](06-transactions-and-categories.md) pairs them one-to-one with saved
rows so edits carry over.

## Sandbox samples (staging only)

`POST /api/sandbox-samples`: refuses in production (403). For each of `transactions` and `investments` without an
active connection, create a Plaid Sandbox public token (institution `ins_109508`) and save it as above, then sync.
The UI offers "Load sandbox samples" on an empty page when Sandbox keys exist.

## Schedule and the worker

- `server/worker.ts` starts pg-boss on `DATABASE_URL`, creates the queue `<plaidEnv>-sync`, and works it by calling
  `syncAll`. It applies the schedule on start and **re-reads it every 30 seconds**, re-scheduling only when
  `[enabled, cron, timezone]` changed; disabled → `unschedule`. It logs which schedule it applied. `SIGTERM` stops it.
- **Schedule setting** (`settings.sync_schedule`, validated by `syncScheduleBody`): `{enabled, frequency, every,
weekday, day, time 'HH:MM', timezone}` where `frequency` is `hours` (every 1, 2, 3, 4, 6, 8 or 12 hours; only the
  minute of `time` counts), `days` (every 1-15 days, counted from the 1st of each month), `weekly` (weekday 0-6, 0 =
  Sunday) or `monthly` (day 1-28). `timezone` is an IANA name.
- **Cron mapping** (`scheduleCron`): hours → `m */n * * *`; days → `m h */n * *`; weekly → `m h * * dow`; monthly →
  `m h day * *` (`*` instead of `*/1`). `cronSchedule(cron)` is the inverse for the deployment default; a shape
  Settings cannot show yields `frequency: null` and is replaced when saved.
- `GET /api/sync/schedule` → the saved or default schedule plus `cron`, `source` (`settings` | `default`) and
  `default`. `PUT /api/sync/schedule` saves a body, or `{reset: true}` returns to `SYNC_CRON`/`SYNC_TIMEZONE`. The
  default is 13:00 America/Los_Angeles every day.
- `GET /api/overview` → `runs` (last 8 `sync_runs`) feeds the activity list.

## Pages

Built in [09 · Settings](09-settings-navigation-and-private-mode.md): **Connections** (one card per connection with the institution's
initial, status, last sync, added date and consent expiry, Reconnect and Disconnect; a connection that needs attention
is outlined in clay with a filled Reconnect and a "Needs attention" tag; a disconnected one has no actions),
**Add an account**, and **Sync settings & activity** (the schedule written as a sentence, "Moneyrill checks your banks
every day at 6:00 AM.", the controls above, "Use the default", and the recent runs). **Sync accounts** (in Settings, and the round top-bar button in production) syncs on demand.

## Acceptance checks

- Token encryption round-trips, a wrong key or tampered value fails, a missing key says what to do
  (`tests/token-crypto.test.ts`).
- Link products: new Link requests Transactions with Investments as an additional consented product; update mode has
  account selection and no products; `investments` is dropped when no investment account exists
  (`tests/link-products.test.ts`).
- Re-matching: an account added back with a new id is matched to the saved one; accounts Plaid still returns are
  untouched; a different name, digits, kind or currency is never merged; no digits means no match; two candidates on
  either side leave both unmatched; several matches at once work (`tests/account-match.test.ts`).
- Sync invariants (integration and unit): one connection failing leaves the others updated and their prior data intact;
  a transactions failure keeps the balances; a repeat sync the same day adds no snapshot or holding rows and keeps one
  daily snapshot while the observation history grows; an account Plaid stops returning is excluded once, kept with its
  history, and a manual re-include sticks; a second concurrent sync answers "busy".
- Disconnect keeps balances and history, clears the token, and is idempotent.
- Environment: a production app rejects a sandbox token or public token; sandbox samples refuse in production.
- Schedule: every frequency maps to the cron above and back (`tests/sync-schedule.test.ts`); invalid hour steps, days
  or time zones are refused; reset returns the default; the worker applies a saved change within 30 seconds.
- UI (`tests/ui/connections.test.tsx`, `tests/ui/sync-settings.test.tsx`): the cards and states above; the schedule
  sentence follows what is saved.
