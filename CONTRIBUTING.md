# Contributing

Contributions are welcome: bug fixes, tests, documentation, and features that fit a one-person, self-hosted, local-first app (read [SECURITY.md](SECURITY.md) for what Moneyrill is and is not designed for).

## If you are new here

```sh
git clone <your fork> && cd moneyrill
npm ci                       # also installs the git hooks (format, lint, types and tests before every commit)
npm run check                # the same checks CI runs
./scripts/setup.sh staging && ./scripts/deploy.sh staging   # demo data at http://localhost:3002
```

1. Open an issue first for anything larger than a small fix, so we agree it fits.
2. Branch from `main`, keep the pull request to one purpose, and add tests with the behaviour change.
3. Never include real financial data, account numbers, tokens or keys in code, tests, screenshots or issues. Use obviously fake values (`Example Bank`, `1111`). `./scripts/scan-secrets.sh` checks for common mistakes.
4. Database changes are new numbered, additive migrations in `server/db/migrations/`; never edit an applied one.
5. Open the pull request; CI must pass. The maintainer merges and releases.

Everything below describes the maintainer's own flow (staging, pull request, merge gate, release). You do not need it to contribute, but it explains what happens after you open a pull request.

---

## How changes are made here

Every change, by you or by an AI assistant, follows the same path. `main` only ever receives
pull requests that passed the local gate (and CI), and production only ever runs what was merged to `main`.

```
branch  →  commit  →  stage + try (local gate)  →  pull request  →  merge  →  stage on main  →  promote
```

## 1. Start a branch

```sh
./scripts/branch.sh private-mode        # creates feature/private-mode from the latest origin/main
```

Never work on `main`: the pre-commit hook refuses commits there and the pre-push hook refuses pushes.
Check what others (other sessions, other machines) already put on main: `git log origin/main --oneline -10`.

## 2. Change, test, commit

- Add or update tests with the behaviour change. Database changes are new numbered migrations in
  `server/db/migrations/`, additive only (never edit an applied one).
- `npm run check` runs everything (format, lint, types, server tests, UI tests). The pre-commit hook runs it.
- Update `README.md` / `TODO.md` / `docs/` when behaviour, commands or limits change. For a new feature or a big change, keep **all** the docs in sync in the same pull request, above all the feature's spec in `docs/specs/` (see [Keeping the docs in sync](docs/specs/README.md#keeping-the-docs-in-sync)).

## 3. Try it on staging (fake data)

```sh
git push -u origin HEAD                  # CI also runs on the branch
./scripts/ship.sh --stage-only           # local gate: checks, disposable-database integration test, deploy to http://localhost:3002, smoke test
```

Click through what you changed. Staging never holds real data and never touches production.

## 4. Pull request, merge

```sh
./scripts/pr.sh "Short, specific title"          # pushes and opens the pull request
./scripts/merge-pr.sh 12                         # squash-merges a commit that passed the local gate, returns to updated main
./scripts/merge-pr.sh 12 --wait                  # or wait (up to 20 minutes) for a green GitHub CI instead
```

The **local gate** is `./scripts/ship.sh --stage-only` on the pushed, clean branch: format, lint, types, unit and UI
tests, the migrations on an empty database and the API integration test on a disposable PostgreSQL
(`./scripts/integration.sh`), the staging deploy (which builds the image and runs the tests inside it) and the staging
smoke test. When all of it passes, `ship.sh` records that exact commit as verified in `.releases/history.log`, and
`merge-pr.sh` then merges it without waiting for a GitHub runner. A new push needs a new run, because the gate is per
commit. `merge-pr.sh` never merges a commit whose CI has failed, and a commit that has not passed the local gate needs a
green CI instead.

CI (`.github/workflows/ci.yml`, one `check` job: format, lint, types, tests, build, migrations, API integration)
keeps running on every pull request and on `main`; its result is the second opinion, and `ship.sh --promote-only`
refuses a commit whose CI has failed. Merges are squashed, one commit per pull request.

## 5. Release

```sh
./scripts/ship.sh --stage-only           # on main: rebuild what was merged and smoke-test it on staging
./scripts/ship.sh --promote-only         # shows the commits and migrations going out, asks you to type "promote"
```

Production only changes when its owner explicitly says so. The release runs a backup, a migration
rehearsal on a restored copy of production, the deploy, and a smoke test of production;
`./scripts/rollback.sh` returns to the previous image.

## Rules of thumb

- One purpose per branch; small pull requests are easier to review and to roll back.
- Never commit secrets: `.env*`, `secrets/`, `backups/` are git-ignored. Never paste tokens into chat or logs.
- Staging is Plaid Sandbox only; real connections are made in production. A new real connection uses one
  of the 10 free Plaid Items, so use **Reconnect**, not Add, to refresh a login.
- Emergency overrides exist (`ALLOW_MAIN_COMMIT=1`, `ALLOW_MAIN_PUSH=1`, `SKIP_REHEARSAL=1`, `git commit --no-verify`);
  use them only when something is already broken and say so in the commit message.
- GitHub branch protection on `main` is not available for private repositories on the free plan, so the rules are
  enforced locally (hooks, `merge-pr.sh`, `ship.sh`). With GitHub Pro, run `python3 scripts/gh.py protect`.
