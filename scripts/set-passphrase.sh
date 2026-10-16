#!/bin/sh
# Set, change or clear the sign-in passphrase (typed here, never stored in a file or shell history).
# A fresh installation can also create its first one in the browser: see setup-code.sh.
#   ./scripts/set-passphrase.sh production      set / change
#   ./scripts/set-passphrase.sh staging --clear remove it
set -eu
trap "stty echo 2>/dev/null || true" EXIT INT TERM
cd "$(dirname "$0")/.."
environment="${1:-production}"
. ./scripts/instance.sh
case "$environment" in
  production | staging) app="$(instance_name "$environment")-$environment-app-1" ;;
  *) printf '%s\n' 'Usage: set-passphrase.sh [production|staging] [--clear]' >&2; exit 1 ;;
esac
if [ "${2:-}" = "--clear" ]; then
  docker exec "$app" ./node_modules/.bin/tsx server/set-passphrase.ts --clear
  exit 0
fi
printf 'New passphrase (12+ characters, input hidden): '
stty -echo; read -r first; stty echo; printf '\n'
printf 'Repeat it: '
stty -echo; read -r second; stty echo; printf '\n'
[ "$first" = "$second" ] || { printf '%s\n' 'Passphrases do not match.' >&2; exit 1; }
printf '%s' "$first" | docker exec -i "$app" ./node_modules/.bin/tsx server/set-passphrase.ts
