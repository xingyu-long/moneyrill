#!/bin/sh
# Merge a pull request once CI is green (squash), then return to an up-to-date main.
#   ./scripts/merge-pr.sh NUMBER [--wait]     --wait polls CI for up to 20 minutes
set -eu
cd "$(dirname "$0")/.."
[ -n "${1:-}" ] || { echo 'Usage: ./scripts/merge-pr.sh NUMBER [--wait]' >&2; exit 2; }
python3 scripts/gh.py pr-merge "$@"
branch="$(git rev-parse --abbrev-ref HEAD)"
git checkout -q main
git pull -q --ff-only origin main
[ "$branch" = "main" ] || git branch -D "$branch" >/dev/null 2>&1 || true
echo "main is now $(git rev-parse --short HEAD). Next: ./scripts/ship.sh --stage-only, then --promote-only when you say so."
