#!/bin/sh
# Dress rehearsal for a release: restore a FRESH copy of production into a throwaway database,
# run the candidate image's migrations on it, and verify nothing was lost or changed.
# The live production database is only read (pg_dump). Also takes the pre-deploy backup.
#
#   ./scripts/rehearse-migrations.sh [IMAGE]                 default: the image deployed to staging
#   ./scripts/rehearse-migrations.sh IMAGE --migrations DIR  try a migrations folder before building
set -eu
cd "$(dirname "$0")/.."
PATH="$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
image="${1:-$(cat .releases/staging-image)}"
mounts=""
if [ "${2:-}" = "--migrations" ]; then
  mounts="-v $(cd "$3" && pwd):/app/server/db/migrations:ro"
fi
[ -f .releases/production-image ] || { echo 'No production release yet; nothing to rehearse.'; exit 0; }

compose() { APP_IMAGE="$(cat .releases/production-image)" docker compose --env-file .env.production -f compose.production.yaml "$@"; }
. ./scripts/instance.sh
instance="$(instance_name production)"
password="$(grep -E '^POSTGRES_PASSWORD=' .env.production | cut -d= -f2)"
network="$instance-production_default"

echo "1/4 Fresh encrypted backup of production"
./scripts/backup.sh production > /tmp/rehearsal-backup.log
head -1 /tmp/rehearsal-backup.log
newest="$(ls -1t backups/encrypted/production-*.dump.enc | head -1)"

cleanup() { compose exec -T db dropdb -U "$instance" --if-exists rehearsal >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
echo "2/4 Restoring it into a throwaway database (production itself is untouched)"
compose exec -T db createdb -U "$instance" rehearsal
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:secrets/backup.key -in "$newest" \
  | compose exec -T db pg_restore -U "$instance" -d rehearsal --no-owner

echo "3/4 Running $image migrations on the copy"
# shellcheck disable=SC2086
result="$(docker run --rm --network "$network" $mounts \
  -e DATABASE_URL="postgres://${instance}:${password}@db:5432/rehearsal" \
  -e APP_ENV=production -e PLAID_ENV=production \
  -v "$PWD/tests/rehearsal-check.ts:/app/tests/rehearsal-check.ts:ro" \
  "$image" ./node_modules/.bin/tsx tests/rehearsal-check.ts | grep '^{' | tail -1)"

echo "4/4 Result: $result"
case "$result" in
  *'"result":"PASS"'*) echo "Rehearsal passed. Throwaway database removed." ;;
  *) echo "Rehearsal FAILED. Do not promote this image." >&2; exit 1 ;;
esac
