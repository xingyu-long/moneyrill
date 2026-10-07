#!/bin/sh
# One command to release a change safely.
#
#   ./scripts/ship.sh                 checks -> staging -> smoke test -> asks -> production -> smoke test
#   ./scripts/ship.sh --stage-only    stop after staging so you can try it at http://localhost:3002
#   ./scripts/ship.sh --promote-only  promote the image already on staging (after you tried it)
#   ./scripts/ship.sh --yes           do not ask before promoting (for automation)
#
# Stops at the first failure. Production also gets the migration rehearsal and a backup
# (see deploy.sh). History of releases: .releases/history.log
set -eu
cd "$(dirname "$0")/.."
PATH="$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
mkdir -p .releases

assume_yes=0; stage_only=0; promote_only=0
for arg in "$@"; do
  case "$arg" in
    --yes) assume_yes=1 ;;
    --stage-only) stage_only=1 ;;
    --promote-only) promote_only=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s\n' "$1"; }
fail() { printf '\nSTOPPED: %s\n' "$1" >&2; log "STOPPED $1"; exit 1; }
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> .releases/history.log; }

step "1. Working tree"
[ -z "$(git status --porcelain)" ] || fail "uncommitted changes. Commit them first."
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin 2>/dev/null || echo "(could not reach GitHub; skipping the pushed-to-origin check)"
if [ "$branch" = "main" ]; then
  if git rev-parse -q --verify origin/main >/dev/null; then
    [ "$(git rev-list --count origin/main..HEAD)" = "0" ] || fail "main has commits that were not merged through a pull request. Production releases come from merged pull requests (see CONTRIBUTING.md)."
    [ "$(git rev-list --count HEAD..origin/main)" = "0" ] || fail "main is behind origin. Pull first: git pull --ff-only"
  fi
else
  # On a feature branch you may only stage, to try the change before opening/merging the pull request.
  [ "$stage_only" = 1 ] || fail "on branch $branch you can only stage: ./scripts/ship.sh --stage-only. Production releases come from main after the pull request is merged."
  git rev-parse -q --verify "origin/$branch" >/dev/null || fail "push the branch first (./scripts/pr.sh \"Title\") so CI runs on it."
  [ "$(git rev-list --count "origin/$branch"..HEAD)" = "0" ] || fail "commits on $branch are not pushed yet."
fi
head_sha="$(git rev-parse --short HEAD)"
echo "On $branch at $head_sha, clean and pushed."

if [ "$promote_only" = 0 ]; then
  step "2. Format, lint, types, unit and UI tests"
  npm run check --silent || fail "checks failed."

  # What CI's migration and integration steps do, on a disposable database (see scripts/integration.sh).
  step "2b. Migrations on an empty database and API integration test"
  ./scripts/integration.sh || fail "the integration test failed."

  step "3. Deploy to staging"
  out="$(./scripts/deploy.sh staging 2>&1)" || { printf '%s\n' "$out" | tail -25; fail "staging deploy failed (see above). Production was not touched."; }
  printf '%s\n' "$out" | tail -3
fi

image="$(cat .releases/staging-image 2>/dev/null || true)"
[ -n "$image" ] || fail "nothing has been deployed to staging yet."
case "$image" in
  *":$head_sha-"*) ;;
  *) fail "the staging image ($image) was not built from this commit ($head_sha). Run without --promote-only." ;;
esac

step "4. Smoke test staging"
npx tsx tests/smoke.ts http://localhost:3002 sandbox "$head_sha" || fail "staging smoke test failed. Production was not touched."

if [ "$stage_only" = 1 ]; then
  log "STAGED $image"
  # This exact commit passed every local gate (clean, pushed, checks, integration, staging, smoke test):
  # merge-pr.sh merges it without waiting for a GitHub runner.
  log "VERIFIED $(git rev-parse HEAD)"
  printf '\nStaging is ready at http://localhost:3002 (%s).\nTry it, then run: ./scripts/ship.sh --promote-only\n' "$image"
  exit 0
fi

step "5. What will change in production"
current="$(cat .releases/production-image 2>/dev/null || true)"
echo "Image:       $image"
echo "Production:  ${current:-none yet}"
prod_sha="$(printf '%s' "$current" | sed -n 's/.*:\([0-9a-f]\{7\}\)-.*/\1/p')"
if [ -n "$prod_sha" ] && git cat-file -e "$prod_sha" 2>/dev/null; then
  echo "Changes since production:"
  git log --oneline "$prod_sha..HEAD" | sed 's/^/  /'
fi
. ./scripts/instance.sh
prod="$(instance_name production)"
applied="$(docker exec "$prod-production-db-1" psql -U "$prod" -d "$prod" -Atc 'SELECT version FROM schema_migrations' 2>/dev/null || true)"
new_migrations="$(ls server/db/migrations | while read -r f; do printf '%s\n' "$applied" | grep -qx "$f" || echo "  $f"; done)"
if [ -n "$new_migrations" ]; then printf 'New database migrations (rehearsed on a copy first):\n%s\n' "$new_migrations"; else echo "No new database migrations."; fi

# CI also runs on main after a merge. Never promote a commit it has failed; one still running is only a notice.
ci_rc=0; ci_out="$(python3 scripts/gh.py ci "$(git rev-parse HEAD)" 2>&1)" || ci_rc=$?
echo "$ci_out"
[ "$ci_rc" != 1 ] || fail "CI failed on this commit. Fix it before promoting."
[ "$ci_rc" = 0 ] || echo "(CI has not finished or could not be read; the local gate above already passed for this commit.)"

if [ "$assume_yes" = 0 ]; then
  # Only the exact word "promote" continues. Anything else, an empty answer or a failed read declines.
  # SHIP_ANSWER lets automation and tests supply the answer without a terminal.
  if [ -n "${SHIP_ANSWER+x}" ]; then
    answer="$SHIP_ANSWER"
  else
    [ -t 0 ] && [ -r /dev/tty ] || fail "no terminal to ask on. Use --yes to promote without asking."
    printf '\nType "promote" to release this to production (anything else cancels): '
    answer=""
    read -r answer </dev/tty || answer=""
  fi
  if [ "$answer" != "promote" ]; then
    log "DECLINED $image"
    echo "Not promoted. Production is unchanged; staging keeps $image."
    exit 0
  fi
fi

step "6. Deploy to production (backup + migration rehearsal first)"
out="$(./scripts/deploy.sh production "$image" 2>&1)" || { printf '%s\n' "$out" | tail -25; fail "production deploy failed (see above)."; }
printf '%s\n' "$out" | tail -8

step "7. Smoke test production"
if ! npx tsx tests/smoke.ts http://localhost:3003 production "$head_sha"; then
  log "PRODUCTION SMOKE FAILED $image"
  printf '\nProduction failed its smoke test. To go back to the previous version run:\n  ./scripts/rollback.sh\n' >&2
  exit 1
fi
log "RELEASED $image"
printf '\nReleased %s to production. Staging and production now run the same image.\n' "$image"
