# Instructions for AI assistants working in this repository

Read `CONTRIBUTING.md` and `README.md` first. This is Moneyrill, a personal finance app (React + TypeScript + Vite
UI, Fastify API, PostgreSQL, Docker). An installation holds someone's real financial data in production, so be careful.
If a `CLAUDE.local.md` exists next to this file, it holds the maintainer's own rules for their installation and wins over
this file where they differ.

## Always follow this workflow (no exceptions unless the maintainer says otherwise)

1. **Never commit or push to `main`.** Start from the latest main: `git fetch`, then `./scripts/branch.sh <name>`.
   If you notice commits you did not write on `origin/main`, read them (`git log origin/main`) before building on them.
   Other sessions may work in this repository at the same time and do not share your context: check `git status`,
   `git branch` and `TODO.md` before you start, and prefer your own worktree (`git worktree add ../moneyrill-<name> -b feature/<name> origin/main`)
   so branch switches and builds do not collide. Staging (3002) is shared: one `ship.sh --stage-only` at a time.
2. Make the change **with tests**, keep `npm run check` green, update docs (README, TODO, the feature's spec in `docs/specs/` with its acceptance checks). For a new feature or a big change keep **all** the docs in sync in the same pull request (see `docs/specs/README.md`, "Keeping the docs in sync").
3. Push the branch and try it on staging: `./scripts/ship.sh --stage-only`. It is the local gate: checks, a disposable-database
   integration test, staging deploy and smoke test, and it records this exact commit as verified. Verify the behaviour
   yourself (the sign-in page, API/UI checks; behind sign-in, ask the maintainer to look) and report what you saw.
4. Open a pull request with `./scripts/pr.sh "Title"`. **Then stop and ask the maintainer to approve the merge;
   merge with `./scripts/merge-pr.sh <n>` only after the maintainer says so** ("merge it"). It merges a commit that passed the
   local gate (step 3) without waiting for a GitHub runner, never one whose CI has failed, and `--wait` makes it wait for a
   green CI instead. If you push again, stage again: the gate is per commit. CI keeps running on the pull request and on `main`. A request to build or fix
   something is NOT approval to merge, and approval for one pull request does not cover the next. Do not merge a failing
   or unverified pull request. Say what you verified on staging when you ask.
5. Releasing: on main run `./scripts/ship.sh --stage-only` (the local gate again; `--promote-only` also refuses a commit whose CI has failed). **Promote to production only when the maintainer explicitly asks**
   ("promote", "ship it"), with `./scripts/ship.sh --promote-only --yes`. A request to build or fix something is NOT
   a request to promote. Always list the commits that will go out (ship.sh prints them), including ones from other sessions.
6. After a release, say plainly what changed, what you verified, and anything you could not verify.

## Working agreements

- Follow the code next to yours: naming, comment density, file layout. Make the smallest change that does the job.
- Reuse what exists (helpers in `src/lib`, `server/lib`, components in `src/components/ui`) before adding a new one.
  A new dependency, table or background job needs a sentence of justification in the pull request.
- A refactor must not change behaviour. If behaviour does change, write "before -> after" in the pull request.
- Test the invariants as well as the happy path (for example: an excluded account never counts, a failed provider
  does not break the others, user edits win over synced data).
- Scale checks to the change: a docs-only change needs correct paths and `npm run format:check`; anything else needs
  `npm run check`.

## Code map

- `server/routes/*` are thin: parse with the zod schemas in `server/lib/schemas.ts`, call a service, return JSON.
- `server/services/*` hold the logic and the SQL (via `server/db`). `server/lib/*` is pure helpers with no I/O.
- `server/db/migrations/` are numbered, additive SQL files. `server/db/seed.ts` is sandbox/staging data only.
- `src/lib/*` is pure and unit-tested; `src/state/*` are the hooks and context; `src/components/*` are UI
  (Tailwind, with shadcn-style primitives in `src/components/ui`).
- Tests: `tests/*.test.ts` server and pure code, `tests/ui/*` React (vitest), `tests/integration.ts` API against a
  disposable database, `tests/smoke.ts` against a running stack.
- Money is `decimal.js` or decimal strings, never floating point. Dates are UTC.
- Never log balances, holdings, tokens or account numbers (`server/lib/log.ts` is the logger). Persisted keys and
  cookie names are named constants, not repeated strings.

## Safety rules for this project

- **Production data is real.** Do not read, copy or print balances, holdings or tokens unless the task needs it, and then
  only the minimum. Never copy production data into staging. Staging is fake data + Plaid Sandbox only.
- **Never ask for or handle the sign-in passphrase.** The maintainer creates and changes it in the app (sign-in page,
  Settings → Sign-in), separately for staging and production. The gate never needs one: the integration test makes its
  own throwaway passphrase on its disposable database, and the smoke test checks only what works signed out. To see
  staging signed in, ask the maintainer to look (or to give a throwaway passphrase for that session and change it
  afterwards). The recovery command is in `docs/development/OPERATIONS.md` (Sign-in); never run it on production.
- **Never commit secrets** (`.env*`, `secrets/`, `backups/`) or echo them. Tokens only travel through stdin/files, not arguments.
- **Do not create new real Plaid Items** without being asked (a Plaid trial allows only a few, and deleting one does not
  give a slot back); use Reconnect.
- **Network exposure:** the app may listen only on localhost and the private Wi-Fi address. Never bind `0.0.0.0`, never
  tunnel or port-forward it. `deploy.sh` refuses non-private bind addresses; do not weaken that.
- **Database changes** are new numbered, additive migrations only; the rehearsal on a restored production copy must pass.
  Never edit an applied migration.
- Do not run production deploys, rollbacks or restores, or change `.env.production`, on your own initiative.
- **Never merge a pull request without the maintainer's approval** (see workflow step 4). Opening the pull request is fine.
- Do not skip hooks or checks (`--no-verify`, `SKIP_REHEARSAL`, `ALLOW_MAIN_*`) without the maintainer's say-so.

## Useful commands

```sh
npm run check                      # format, lint, typecheck, server + UI tests
./scripts/ship.sh --help           # release flow (staging, smoke test, promote)
npx tsx tests/smoke.ts URL MODE [COMMIT]
python3 scripts/api-snapshot.py PORT baseline|compare
python3 scripts/gh.py protection   # is main protected on GitHub?
./scripts/scan-secrets.sh --history  # secrets and personal data in files and history (add --terms FILE)
```

Staging: http://localhost:3002 (sandbox, fake data). Production: http://localhost:3003 (real data). Both require sign-in; each has its own passphrase, created in the app.
