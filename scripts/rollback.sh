#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./scripts/instance.sh
PRODUCTION_PORT="$(env_port production)"; export PRODUCTION_PORT
if [ ! -s .releases/previous-production-image ]; then
 printf '%s\n' 'No previous production release recorded.' >&2; exit 1
fi
./scripts/backup.sh production
previous="$(cat .releases/previous-production-image)"
current="$(cat .releases/production-image)"
APP_IMAGE="$previous" docker compose --env-file .env.production -f compose.production.yaml $(grep -qE "^BIND_ADDRESS=(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\." .env.production && printf -- "-f compose.production.lan.yaml") up -d --wait
printf '%s\n' "$previous" > .releases/production-image
printf '%s\n' "$current" > .releases/previous-production-image
printf '%s\n' 'Previous application image restored. Database retained; this requires backward-compatible migrations.'
