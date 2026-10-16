# First-run passphrase setup in the UI

Status: implemented on `feature/first-run-setup` (step 4, the Settings entry for localhost-only mode, was left out); the open decision is settled (setup code in LAN mode). Written 2026-10-15 for a later session to carry out on `feature/first-run-setup`.

Today the passphrase can only be set on the host with `./scripts/set-passphrase.sh`, and the login page tells you to
run it. The goal: on a **fresh installation** (no passphrase stored yet) the login page lets you choose the passphrase
right there and signs you in. **Once a passphrase exists, the page only ever asks for it**, exactly as now. Nothing in
the UI can change, reset or clear an existing passphrase; that stays host-only (`set-passphrase.sh`), so an installation
that already has one (production today) behaves exactly as before.

## Behaviour

| State                            | Today                                   | After                                                              |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| Passphrase set                   | Login page asks for it                  | Unchanged                                                          |
| No passphrase, localhost only    | App open, no sign-in                    | Unchanged (open); Settings offers "Set a passphrase" (see step 4)  |
| No passphrase, `ALLOW_LAN=true`  | Login page says "run set-passphrase.sh" | Login page shows **Create a passphrase** (+ setup code, see below) |
| Setup attempted after one exists | n/a                                     | 409 "A passphrase is already set", nothing changes                 |

The create form: passphrase + repeat (both `type="password"`, `autoComplete="new-password"`), the 12-character
minimum shown up front, the same error box and version line as the sign-in form. On success the browser holds a
session and the app loads; the page never shows the setup form again on any device.

## Decision: a one-time setup code in LAN mode

Decided by the owner on 2026-10-15. With `ALLOW_LAN=true` the app is reachable from the Wi-Fi before a passphrase
exists, so without a guard whoever opens the page first could choose it. The `Host` header is not a boundary (a LAN
client can send `Host: localhost` to the private address), and `req.ip` inside Docker is the bridge gateway, so
"only from the host computer" cannot be enforced in the app. Therefore:

- In LAN mode with no passphrase, `deploy.sh` (already run in a terminal for a fresh install) asks the app to create a
  random code (8 characters of base32 shown as `XXXX-XXXX`, stored only as a SHA-256 in `settings.auth_setup_code` with
  a 1-hour expiry) and prints `Open http://localhost:3003 and enter setup code XXXX-XXXX` once. The create form asks
  for the code too. Running the step again replaces the code; an expired code is useless.
- Localhost-only mode needs no code: there, anyone who can reach the page already has full access because the app is
  open.

## Steps

1. **Store (server/auth/store.ts).** Add `createPassphrase(record): Promise<boolean>` to `AuthStore`: an atomic
   insert that only succeeds when no row exists (`INSERT ... ON CONFLICT(key) DO NOTHING`, return `rowCount === 1`),
   so two racing setups cannot overwrite each other or an existing passphrase. It also deletes `sessions` and the
   setup code. Mirror it in `MemoryAuthStore`. For the code: `setSetupCode(hash, expiresAt)`,
   `getSetupCode()`, cleared on use. No migration needed (`settings` is a key/value table); confirm that.
2. **Service (server/auth/service.ts).** `status()` gains `setup: boolean` (true when no passphrase **and** sign-in
   is required, i.e. LAN mode) and `setupCode: boolean` (a code is required). New `setup(passphrase, code, client)`:
   - refuses with 409 if a passphrase exists (check, then rely on the atomic insert for the race);
   - in LAN mode checks the code (constant-time compare of hashes, expiry) and shares the existing per-address
     failure counter and lockout with `login()` so the code cannot be brute-forced;
   - `hashPassphrase()` enforces the 12-character minimum (400 with its message);
   - on success creates a session exactly like `login()` and returns the token. Extract the session-creation lines
     from `login()` into a private helper instead of copying them.
     Change the 503 message in `login()` and the 401 text in `server/routes/auth.ts` to point to the setup form.
3. **Route (server/routes/auth.ts).** `POST /api/auth/setup` `{passphrase, code?}` parsed with a zod schema in
   `server/lib/schemas.ts`; add the path to `OPEN`; set the cookie the same way as login. Keep the route thin.
4. **Localhost-only, no passphrase (optional, ask the owner).** The app is open there, so the login page never shows.
   Offer the same form in Settings ("Require a passphrase on this computer") only while none is set; it calls the
   same endpoint. Once one is set the Settings entry disappears. If the owner does not want this, skip it.
5. **UI (src/components/LoginPage.tsx, src/state/useAppModel.ts).** `auth` gets `setup` and `setupCode`; add
   `setUp(passphrase, code)` next to `signIn` in the model (calls the endpoint, then `checkAuth()`). Replace the
   "run set-passphrase.sh" branch of `LoginPage` with the create form (repeat field must match before submit; code
   field only when `setupCode`). Reuse `Field`, `Input`, `Button`, `Card` and the existing error box.
6. **Setup code CLI.** `server/setup-code.ts` (like `server/set-passphrase.ts`): if no
   passphrase exists, create a code, store its hash, print the code; otherwise print "A passphrase is already set"
   and exit 0. `deploy.sh` runs it after a healthy start when `ALLOW_LAN=true`; never log it through
   `server/lib/log.ts`. Make sure `scripts/scan-secrets.sh` and the smoke test do not trip on it.
7. **Keep `set-passphrase.sh`** as the only way to change or clear a passphrase (and the recovery path if it is
   forgotten). Update its header comment and the help text only.

## Tests

- `tests/auth.test.ts` (MemoryAuthStore): setup with no passphrase signs in and sets the cookie; setup when one
  exists answers 409 and the old passphrase still works and old sessions survive; two concurrent setups → exactly
  one wins; a short passphrase answers 400 and stores nothing; LAN mode: missing/wrong/expired code is refused,
  wrong codes count toward the lockout, a used code cannot be reused; `/api/auth/setup` is reachable without a
  session but every data endpoint still answers 401 before setup.
- `tests/ui/login.test.tsx`: configured → sign-in form only (no create form, no repeat field); setup → create form;
  mismatched repeat disables submit; code field only when asked for; server error shown in the alert.
- `tests/integration.ts` (real database): the atomic insert refuses a second setup.
- `tests/smoke.ts`: `/api/auth/status` includes `setup`; on production `setup` is false (a passphrase exists) and
  `POST /api/auth/setup` answers 409. Do not send a real passphrase to production.

## Verification on staging

Staging normally has no passphrase. With `ALLOW_LAN` off it stays open (unchanged). To try the LAN flow use a
throwaway passphrase only: clear any passphrase (`./scripts/set-passphrase.sh staging --clear`), start staging in LAN
mode or set `alwaysRequired` via env for the check, see the create form, set a random passphrase, confirm sign-out and
sign-in, confirm a second setup is refused, then `--clear` again. Never touch production's passphrase; after
promotion only confirm that production still shows the plain sign-in form.

## Docs to update in the same pull request

- `docs/specs/02-foundation.md` "Sign-in": the setup endpoint, `status` fields, the setup-code rules, new acceptance
  checks.
- `docs/specs/09-settings-navigation-and-private-mode.md` "Sign-in page" (and Settings if step 4 is done).
- `docs/development/OPERATIONS.md` "Sign-in": first run in the browser; `set-passphrase.sh` for change, clear and
  recovery.
- `README.md` quick start if it mentions setting the passphrase; `TODO.md` if it lists this.
