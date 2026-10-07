#!/bin/sh
# Start a change: a fresh branch from the latest main.   ./scripts/branch.sh short-name
set -eu
cd "$(dirname "$0")/.."
name="${1:-}"
[ -n "$name" ] || { echo 'Usage: ./scripts/branch.sh short-name   (e.g. private-mode)' >&2; exit 2; }
case "$name" in */*) branch="$name" ;; *) branch="feature/$name" ;; esac
[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit or stash them first." >&2; exit 1; }
git fetch -q origin
git checkout -q -b "$branch" origin/main
echo "On new branch $branch (from origin/main). Commit here, then ./scripts/pr.sh \"Title\""
