#!/bin/sh
# Print a one-time code (valid 1 hour) for choosing the first passphrase in the browser when the app is open on the LAN.
# Does nothing once a passphrase exists. Changing or clearing one stays with set-passphrase.sh.
#   ./scripts/setup-code.sh production
set -eu
cd "$(dirname "$0")/.."
environment="${1:-production}"
. ./scripts/instance.sh
case "$environment" in
  production | staging) app="$(instance_name "$environment")-$environment-app-1" ;;
  *) printf '%s\n' 'Usage: setup-code.sh [production|staging]' >&2; exit 1 ;;
esac
docker exec "$app" ./node_modules/.bin/tsx server/setup-code.ts
