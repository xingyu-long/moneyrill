#!/bin/bash
# Build a clean copy of the project for sharing, with a brand-new one-commit history.
#   ./scripts/export-public.sh DEST [--name "Your Name"] [--email you@users.noreply.github.com] [--terms FILE] [--verify]
# - starts from the committed files of HEAD (never your .env, secrets, backups or local changes);
# - leaves out the paths listed in scripts/public-exclude.txt;
# - --verify then runs the copy's own `npm ci && npm run check` and a Docker build;
# - runs scripts/scan-secrets.sh on the result (with --terms FILE if given) and stops if it finds anything;
# - creates a git repository in DEST with a single commit. It never pushes: create an empty repository on GitHub
#   yourself, then `git remote add origin ... && git push -u origin main` from DEST.
# The old history of this repository is not copied: it contains personal data. Do not make this repository public.
set -eu
cd "$(dirname "$0")/.."
dest="${1:-}"; [ -n "$dest" ] || { sed -n '2,10p' "$0" >&2; exit 2; }; shift
name="$(git config user.name || true)" email="" terms="" verify=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="${2:?}"; shift ;;
    --email) email="${2:?}"; shift ;;
    --terms) terms="${2:?}"; shift ;;
    --verify) verify=1 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$email" ] || { echo "Pass --email with the address commits should carry (your GitHub noreply address, so your real one is not published)." >&2; exit 2; }
case "$email" in *@users.noreply.github.com) ;; *) echo "Note: $email is not a GitHub noreply address; it will be public." >&2 ;; esac
[ ! -e "$dest" ] || [ -z "$(ls -A "$dest")" ] || { echo "$dest exists and is not empty." >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit or stash your changes first (the export uses HEAD)." >&2; exit 1; }

mkdir -p "$dest"
git archive --format=tar HEAD | tar -x -C "$dest"
grep -vE '^\s*(#|$)' scripts/public-exclude.txt | while read -r path; do rm -rf "${dest:?}/$path"; done

echo "Scanning the copy ..."
args=(--dir "$dest"); [ -z "$terms" ] || args+=(--terms "$terms")
./scripts/scan-secrets.sh "${args[@]}" || { echo "Stopped: fix the findings (in the source repository), commit, and export again." >&2; rm -rf "$dest"; exit 1; }

cd "$dest"
git init -q -b main
git add -A
GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
  git commit -q -m "Initial public release"
if [ "$verify" = 1 ]; then
  echo "Verifying the copy (npm ci, npm run check, docker build) ..."
  fail() { echo "Verification FAILED: $1. The copy is left in place for you to look at." >&2; exit 1; }
  npm ci --silent || fail "npm ci"
  npm run check --silent >/dev/null || fail "npm run check"
  docker build -q -t moneyrill-export-verify . >/dev/null || fail "docker build"
  docker image rm moneyrill-export-verify >/dev/null 2>&1 || true
  rm -rf node_modules dist
  echo "Verified."
fi
echo "Created $dest with one commit ($(git ls-files | wc -l | tr -d ' ') files). Review it, then push it to a new empty repository."
