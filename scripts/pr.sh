#!/bin/sh
# Push this branch and open a pull request.   ./scripts/pr.sh "Short title" [body-file]
set -eu
cd "$(dirname "$0")/.."
title="${1:-}"
[ -n "$title" ] || { echo 'Usage: ./scripts/pr.sh "Short title" [body-file]' >&2; exit 2; }
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" != "main" ] || { echo "You are on main. Start a branch first: ./scripts/branch.sh name" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit them first." >&2; exit 1; }
git fetch -q origin
git push -u origin "$branch"
python3 scripts/gh.py pr-create "$branch" "$title" "${2:-}"
