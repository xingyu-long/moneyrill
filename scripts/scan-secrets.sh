#!/bin/bash
# Look for secrets and personal data before sharing the code. Prints where something matched, never the value.
#   ./scripts/scan-secrets.sh                     scan the files in the working tree (tracked files of this repository)
#   ./scripts/scan-secrets.sh --history           also scan every commit on every branch
#   ./scripts/scan-secrets.sh --dir DIR           scan a plain directory instead (used by export-public.sh)
#   ./scripts/scan-secrets.sh --terms FILE        also look for the words in FILE, one per line (account digits, your
#                                                 name, employer, merchants ...); keep that file out of the repository
# Exit 0: nothing found. Exit 1: matches. If gitleaks is installed it is run too (recommended: brew install gitleaks).
set -u
cd "$(dirname "$0")/.."
history=0 dir="" terms=""
while [ $# -gt 0 ]; do
  case "$1" in
    --history) history=1 ;;
    --dir) dir="${2:?--dir needs a directory}"; shift ;;
    --terms) terms="${2:?--terms needs a file}"; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

# label|extended regex
patterns=(
  'Plaid access or public token|(access|public|link)-(sandbox|production|development)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  'Plaid secret or client id assignment|PLAID_(SECRET|CLIENT_ID)=[0-9a-f]{20,}'
  'Private key|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AWS access key|AKIA[0-9A-Z]{16}'
  'GitHub token|gh[pousr]_[A-Za-z0-9]{30,}'
  'Slack token|xox[baprs]-[A-Za-z0-9-]{10,}'
  'API key (sk-)|sk-[A-Za-z0-9]{32,}'
  'Password in a connection string|postgres(ql)?://[^:@/ ]+:[^@/ $]{6,}@'
  'Long hex or base64 value assigned to a key/secret/token|(key|secret|token|passphrase)["'"'"']?[=:] *["'"'"']?[A-Za-z0-9+/]{40,}'
)
found="$(mktemp)"; trap 'rm -f "$found"' EXIT
report() { printf '  %s\n' "$1"; echo x >> "$found"; }
# Known placeholders that are not secrets (the throwaway database passwords of staging and CI, variables, examples).
ALLOW='(:|//)(local-staging-only|ci-only|password|changeme|postgres|\$|<)'
real_match() { grep -hoE "$1" | grep -vE "$ALLOW" | grep -q .; }

scan_tree() { # $1 = directory (or "." for tracked files of the repository)
  local label regex file
  for p in "${patterns[@]}"; do
    label="${p%%|*}" regex="${p#*|}"
    if [ "$1" = "." ]; then
      git grep -IlE "$regex" -- . ':!package-lock.json' ':!*.example' 2>/dev/null
    else
      grep -rIlE "$regex" "$1" --exclude=package-lock.json --exclude='*.example' --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null
    fi | while read -r file; do
      [ -f "$file" ] || file="./$file"
      real_match "$regex" < "$file" && report "$label: $file"
    done
  done
  if [ -n "$terms" ]; then
    while IFS= read -r word; do
      [ -n "$word" ] || continue
      if [ "$1" = "." ]; then files="$(git grep -IilF -- "$word" -- . ':!package-lock.json' 2>/dev/null)"
      else files="$(grep -rIilF -- "$word" "$1" --exclude=package-lock.json --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null)"; fi
      [ -z "$files" ] || printf '%s\n' "$files" | while read -r file; do report "your term #$(grep -nFx -- "$word" "$terms" | head -1 | cut -d: -f1): $file"; done
    done < "$terms"
  fi
}

echo "== files"
if [ -n "$dir" ]; then scan_tree "$dir"; else scan_tree .; fi

if [ "$history" = 1 ] && [ -z "$dir" ]; then
  echo "== history (all branches)"
  for p in "${patterns[@]}"; do
    label="${p%%|*}" regex="${p#*|}"
    git log --all -G "$regex" --format='%h' -- . ':!package-lock.json' ':!*.example' | while read -r c; do
      git show "$c" -- . ':!package-lock.json' ':!*.example' | grep '^+' | real_match "$regex" &&
        report "$label: commit $c ($(git log -1 --format=%s "$c" | cut -c1-60))"
    done
  done
  if [ -n "$terms" ]; then
    n=0
    while IFS= read -r word; do
      n=$((n + 1)); [ -n "$word" ] || continue
      git log --all -S"$word" --format='%h' | while read -r c; do report "your term #$n: commit $c"; done
    done < "$terms"
  fi
  echo "  files that should never have been committed:"
  git log --all --name-only --format= | sort -u | grep -E '(^|/)(\.env(\.production)?$|secrets/[^.]|backups/|.*\.(pem|key|dump)$)' | sed 's/^/  /' | grep . && report "(see the files listed above)"
fi

if command -v gitleaks >/dev/null 2>&1; then
  echo "== gitleaks"
  cfg=(); [ -f .gitleaks.toml ] && cfg=(--config .gitleaks.toml)  # known false positives
  if [ -n "$dir" ]; then gitleaks detect ${cfg[@]+"${cfg[@]}"} --no-git --source "$dir" --redact -v || report "gitleaks found something"
  elif [ "$history" = 1 ]; then gitleaks detect ${cfg[@]+"${cfg[@]}"} --source . --redact || report "gitleaks found something"
  else gitleaks detect ${cfg[@]+"${cfg[@]}"} --no-git --source . --redact || report "gitleaks found something"; fi
else
  echo "(gitleaks is not installed; this script only checks common patterns. Install it for a deeper scan.)"
fi

if [ -s "$found" ]; then echo "Found something: look at the places above."; exit 1; fi
echo "Nothing found."
