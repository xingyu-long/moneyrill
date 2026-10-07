# Passphrase in the UI: first-run setup and change in Settings

Status: implemented on `feature/first-run-setup` (revised 2026-10-15; sign-in is now always required, see **Decision: sign-in is always required** below). The owner wants **no scripts** for the passphrase. Everything happens in the browser. Commit
`bbaddd7` on `feature/first-run-setup` built an earlier version of this plan, with a one-time setup code and
`setup-code.sh`. This plan replaces that version. Rework that branch as described below; don't start again from main.

## Decision: sign-in is always required (2026-10-15)

Staging and production behave the same: every installation, on localhost or the LAN, requires sign-in. A fresh one
opens on **Create a passphrase**. The localhost "open until you set one" mode is gone, and so are the `required` and
`setup` status fields, `alwaysRequired` in `AuthService`, and the **Set a passphrase** card in Settings (Settings →
Sign-in only changes the passphrase). Staging has its own passphrase that the maintainer sets, so the gate never
needs it: the integration test creates a throwaway one on its disposable database, and the smoke test checks only
what works signed out. Where the sections below describe open mode, this decision wins.

## What the owner wants

1. **Fresh installation (no passphrase stored):** the sign-in page shows **Create a passphrase**: a new passphrase and
   a repeat field, with no setup code. Submitting it stores the passphrase and signs that browser in.
2. **Passphrase exists:** the sign-in page only asks for it, as it does today. Production already has one and keeps
   it. Nothing about it is reset.
3. **Signed in:** a new Settings page, **Sign-in** (`/settings/sign-in`), changes the passphrase. It asks for the
   current passphrase, the new one and a repeat.
4. **No scripts.** Remove `scripts/set-passphrase.sh` and `server/set-passphrase.ts`, plus everything the earlier
   version added for the setup code.

Keep it simple: no setup code, no "remove passphrase" button, no other new options.

## Accepted trade-offs (state them in the docs)

- **Who claims a fresh LAN install.** With `ALLOW_LAN=true` and no passphrase, whoever opens the page first on the
  Wi-Fi chooses it. The owner accepts this for a home network. The docs should say to create the passphrase right
  after the first deploy. Once a passphrase exists, setup is closed for good (409).
- **Forgotten passphrase.** With no script, the browser has no way to recover. Document one manual recovery command in
  `docs/development/OPERATIONS.md`, run on the host. It deletes the `auth_passphrase` row and all sessions, for example
  `docker exec -i <instance>-production-db-1 psql -U <user> -c "DELETE FROM settings WHERE key='auth_passphrase'; DELETE FROM sessions"`.
  Use the real container name and user from `scripts/instance.sh` and check that the command works on staging. After
  that, the sign-in page offers **Create a passphrase** again. This is a documented command, not a script.
- **Localhost-only mode, no passphrase:** the app stays open, as it is today. The new Sign-in page in Settings then
  offers **Set a passphrase** (new + repeat, using the setup endpoint). Once one is set it shows the change form.

## Server

Starting from the branch as it is:

- **Remove the setup code completely:** `server/auth/setup-code.ts`, `server/setup-code.ts`, `scripts/setup-code.sh`,
  the `print_setup_code` hook in `scripts/deploy.sh`, the `getSetupCode` and `setSetupCode` store methods (Db and
  Memory), the `auth_setup_code` handling inside `createPassphrase`, `issueSetupCode()`, and the code check in
  `AuthService.setup()`. Leave existing databases alone: a stale `auth_setup_code` row on staging is harmless. A
  migration is optional and probably not worth adding.
- **Status:** `GET /api/auth/status` → `{required, configured, authenticated, setup}`. Drop `setupCode`.
  `setup = !configured`. In open localhost mode the sign-in page never shows anyway, so the UI uses `setup` only where
  it applies.
- **`POST /api/auth/setup` `{passphrase}`** stays as built: open endpoint, only while no passphrase exists, atomic
  insert (`createPassphrase`), 409 once one exists, 400 under 12 characters, signs in on success. Drop `code` from
  `setupBody` in `server/lib/schemas.ts`.
- **New `POST /api/auth/passphrase` `{current, passphrase}`.** It needs a session, so it is not in `OPEN`.
  - Add `AuthService.change(current, next, cookieHeader, client)`.
  - A wrong `current` → 401 "Incorrect passphrase". It counts toward the same per-address lockout as sign-in (reuse
    `checkLock` and `fail`).
  - A new passphrase under 12 characters → 400 (from `hashPassphrase`).
  - On success, call `store.setPassphrase(record)`, which already deletes every session (every device is signed out),
    then start a fresh session for this browser and set its cookie, so the person who changed it stays signed in.
  - Add `changeBody` to `server/lib/schemas.ts`. Keep the route thin, like `/api/auth/login`.
- **Messages:** the 503 from `login()` and the 401 for no passphrase say "No passphrase is set yet. Open the app in a
  browser to create one." (already done). Search for any remaining `set-passphrase.sh` text and remove it.

## UI

- **`src/components/LoginPage.tsx`:** keep the create form, but remove the setup-code field, its hint and the
  `setupCode` condition on the button. `useAppModel.setUp(passphrase)` drops the `code` argument, and `auth` drops
  `setupCode`.
- **Settings → Sign-in page:**
  - Add `{ slug: 'sign-in', label: 'Sign-in' }` to `SETTINGS_PAGES` in `src/lib/routes.ts`.
  - Render the page from `src/components/SettingsTab.tsx` / `SettingsPages.tsx`, following the other pages and using
    `SettingsCard`, `Field`, `Input` and `Button`.
  - When `auth.configured` is true, show **Change passphrase**: current, new, repeat. The button is enabled only when
    new is 12 or more characters and matches repeat. Show the server error in the alert. On success, clear the fields
    and say "Passphrase changed. Other devices were signed out."
  - When it is false (open localhost mode), show **Set a passphrase**: new and repeat. It calls `setUp`, and afterwards
    the app requires sign-in.
  - Add `changePassphrase(current, next)` to `src/state/useAppModel.ts` next to `signIn` and `setUp`.
- Reuse one small shared "new + repeat" field group if the sign-in page and Settings can use the same one.

## Tests

- **`tests/auth.test.ts`:**
  - Delete the setup-code tests.
  - Keep and adjust: setup with no passphrase signs in; setup is refused (409) and changes nothing once a passphrase
    exists; a short passphrase is 400; two concurrent setups leave exactly one winner; LAN mode, before setup, gives
    `setup: true` and a 401 on data endpoints.
  - Add for change:
    - No session → 401.
    - A wrong current passphrase → 401, and it counts toward the lockout.
    - A short new passphrase → 400, and the old one still works.
    - Success: the new passphrase signs in and the old one does not; other sessions are gone; the browser that made
      the change still has a working cookie.
- **`tests/ui/login.test.tsx`:** remove the code-field assertions. The create form shows when `configured` is false,
  and only the sign-in form shows when it is true.
- **New UI test for Settings → Sign-in:** the change form when configured; mismatched or short input disables the
  button; a server error shows; success clears the fields. The set form shows when not configured.
- **`tests/routes.test.ts`** (or wherever routes are tested): `/settings/sign-in` resolves.
- **`tests/integration.ts`:** remove the setup-code lines from the first-run block and keep the atomic-insert checks.
- **`tests/smoke.ts`:** keep the 409 check for an installation that already has a passphrase. Remove `setupCode` from
  the "well formed" check.

## Docs (same pull request)

- **`docs/specs/02-foundation.md` "Sign-in":** no scripts; the setup and change endpoints; the status fields; the two
  accepted trade-offs; updated acceptance checks.
- **`docs/specs/09-settings-navigation-and-private-mode.md`:** the sign-in page's create form, and the new Settings →
  Sign-in page.
- **`docs/specs/10-operations-and-release.md`:** remove `set-passphrase.sh` and `setup-code.sh`.
- **`docs/development/OPERATIONS.md` "Sign-in":** first run in the browser, change in Settings, the manual recovery
  command, and "create the passphrase right after the first LAN deploy".
- **`CLAUDE.md`:** the safety rule names `./scripts/set-passphrase.sh` and uses `--clear` for staging tests. Reword it
  so the maintainer sets the passphrase in the UI, and so staging tests create a throwaway passphrase through
  `/api/auth/setup` and clear it with the recovery command. Grep the repo for any other mention of either script
  (`README.md`, `TODO.md`, `scripts/scan-secrets.sh`, `CONTRIBUTING.md`).
- Set this file's status line to "implemented" when done.

## Verify on staging

1. `./scripts/ship.sh --stage-only`.
2. Staging is open (no LAN), so: open Settings → Sign-in, set a random throwaway passphrase, and check that the app
   then asks for it.
3. Sign in, change the passphrase in Settings, and check that you stay signed in while a second browser or curl session
   is signed out.
4. Run the recovery command on staging and check that the app is open again with no passphrase.

Never touch production's passphrase. After a promotion, only check that production still shows the plain sign-in
page.
