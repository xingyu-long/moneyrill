#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
environment="${1:-staging}"
# Extra compose file that also publishes the port on the private LAN address (localhost always works).
lan_files() {
  bind="$(grep -E '^BIND_ADDRESS=' "$1" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' "')"
  if [ -n "$bind" ] && [ "$bind" != "127.0.0.1" ]; then
    if [ "${3:-}" = "-f" ]; then printf -- '-f %s' "$2"; else printf -- '-f compose.yaml -f %s' "$2"; fi
  fi
}
# Never publish the app beyond this computer or the private Wi-Fi/LAN.
check_bind() {
  bind="$(grep -E '^BIND_ADDRESS=' "$1" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' "')"
  case "${bind:-127.0.0.1}" in
    127.0.0.1|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;;
    *) printf 'Refusing to deploy: BIND_ADDRESS=%s is not loopback or a private LAN address (never use 0.0.0.0).\n' "$bind" >&2; exit 1;;
  esac
}
case "$environment" in staging) check_bind .env;; production) check_bind .env.production;; esac
# Never start a second, empty installation beside an existing one: a changed or missing INSTANCE_NAME would otherwise
# give production a new, empty database (the old one stays in its volume). See scripts/instance.sh.
. ./scripts/instance.sh
check_instance() {
  expected="$(instance_name "$1")-$1_database"
  docker volume inspect "$expected" >/dev/null 2>&1 && return 0
  others="$(docker volume ls -q 2>/dev/null | grep -E -- "-$1_database\$" || true)"
  [ -z "$others" ] && return 0
  printf 'Refusing to deploy %s: it would use the new volume %s, but this computer already has %s.\nSet INSTANCE_NAME in %s to the name before "-%s_database", then deploy again.\n' \
    "$1" "$expected" "$(echo $others)" "$(env_file "$1")" "$1" >&2
  exit 1
}
case "$environment" in staging | production) check_instance "$environment";; esac
# Each environment publishes its own port (STAGING_PORT, PRODUCTION_PORT); they must differ to run side by side.
staging_port="$(env_port staging)"; production_port="$(env_port production)"
if [ "$staging_port" = "$production_port" ]; then
  printf 'Refusing to deploy: STAGING_PORT and PRODUCTION_PORT are both %s; give each environment its own port.\n' "$staging_port" >&2; exit 1
fi
export STAGING_PORT="$staging_port" PRODUCTION_PORT="$production_port" # win over the env files compose reads
mkdir -p .releases
case "$environment" in
 staging)
  ./scripts/setup.sh staging
  revision="$(git rev-parse --short HEAD 2>/dev/null || printf development)"
  image="moneyrill-release:$revision-$(date +%Y%m%d%H%M%S)"
  commit="$revision$(git diff --quiet HEAD -- 2>/dev/null || printf -- -dirty)"
  docker build --build-arg COMMIT_SHA="$commit" --build-arg BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" -t "$image" .
  # The tests need the full dependencies and the tests/ folder, which the slim runtime image leaves out: run them in the
  # build stage (cached from the build above). A run that finds no tests must not pass.
  test_image="$image-tests"
  docker build --target build -t "$test_image" . >/dev/null
  tests_out="$(docker run --rm "$test_image" npm test 2>&1)" || { printf '%s\n' "$tests_out" | tail -25; docker image rm "$test_image" >/dev/null 2>&1; printf '%s\n' 'Unit tests failed in the image.' >&2; exit 1; }
  docker image rm "$test_image" >/dev/null 2>&1 || true
  case "$tests_out" in *'# tests 0'*|'') printf '%s\n' 'The image ran no unit tests.' >&2; exit 1;; esac
  APP_IMAGE="$image" docker compose $(lan_files .env compose.lan.yaml) up -d --wait
  printf '%s\n' "$image" > .releases/staging-image
  docker image inspect --format '{{.Id}}' "$image" > .releases/staging-image-id
  printf 'Staging ready at http://localhost:%s\nAfter validation, promote this exact image:\n./scripts/deploy.sh production %s\n' "$staging_port" "$image"
  ;;
 production)
  image="${2:-}"
  if [ -z "$image" ] || [ ! -f .releases/staging-image ] || [ "$image" != "$(cat .releases/staging-image)" ]; then
   printf '%s\n' 'Specify the image deployed to staging first; production never rebuilds source.' >&2; exit 1
  fi
  if [ "$(docker image inspect --format '{{.Id}}' "$image")" != "$(cat .releases/staging-image-id)" ]; then
   printf '%s\n' 'Staging image changed since validation; deploy to staging again.' >&2; exit 1
  fi
  if [ ! -f .env.production ] || [ ! -s secrets/production.key ]; then
   printf '%s\n' 'Run ./scripts/setup.sh production and configure production credentials first.' >&2; exit 1
  fi
  if [ -f .releases/production-image ]; then
   if [ "${SKIP_REHEARSAL:-}" = 1 ]; then
    ./scripts/backup.sh production
   else
    # Backs up production, then proves this image's migrations are safe on a copy of the real data.
    ./scripts/rehearse-migrations.sh "$image"
   fi
   cp .releases/production-image .releases/previous-production-image
  fi
  APP_IMAGE="$image" docker compose --env-file .env.production -f compose.production.yaml $(lan_files .env.production compose.production.lan.yaml -f) up -d --wait
  printf '%s\n' "$image" > .releases/production-image
  printf 'Production ready at http://localhost:%s. Staging data was not copied.\n' "$production_port"
  ;;
 *) printf '%s\n' 'Usage: deploy.sh staging | deploy.sh production IMAGE' >&2; exit 1;;
esac
