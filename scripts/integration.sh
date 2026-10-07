#!/bin/sh
# The API integration test on a disposable database, locally: what CI's "Migrations on an empty database" and
# "API integration test" steps do, so a change can be judged without waiting for a GitHub runner.
#   ./scripts/integration.sh
# Starts a throwaway PostgreSQL and the app image in Docker (published on 127.0.0.1 only, ports 55432 and 3099),
# runs tests/migrations-db.ts and tests/integration.ts, and removes everything again. It never touches staging
# or production: the containers, network and image are all named moneyrill-itest-*.
set -eu
cd "$(dirname "$0")/.."
PATH="$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

net=moneyrill-itest-net; db=moneyrill-itest-db; app=moneyrill-itest-app; image=moneyrill-itest
cleanup() {
  docker rm -f "$app" "$db" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker rmi "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup

echo "Starting a disposable PostgreSQL..."
docker network create "$net" >/dev/null
docker run -d --name "$db" --network "$net" --network-alias "$db" \
  -e POSTGRES_USER=moneyrill -e POSTGRES_PASSWORD=ci-only -e POSTGRES_DB=moneyrill \
  -p 127.0.0.1:55432:5432 postgres:17-alpine >/dev/null
ready=0
for _ in $(seq 1 30); do
  # pg_isready also says yes to the image's temporary start-up server, before the database exists: ask the database itself.
  if docker exec "$db" psql -U moneyrill -d moneyrill -c 'SELECT 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "PostgreSQL did not become ready." >&2; exit 1; }

echo "Migrations on an empty database..."
docker exec "$db" psql -U moneyrill -d moneyrill -c 'CREATE DATABASE migtest' >/dev/null
DATABASE_URL=postgres://moneyrill:ci-only@127.0.0.1:55432/migtest npx tsx tests/migrations-db.ts

echo "Building the app image..."
docker build -q -t "$image" . >/dev/null
docker run -d --name "$app" --network "$net" -p 127.0.0.1:3099:3002 \
  -e DATABASE_URL="postgres://moneyrill:ci-only@$db:5432/moneyrill" \
  -e APP_ENV=staging -e PLAID_ENV=sandbox "$image" >/dev/null
healthy=0
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3099/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
[ "$healthy" = 1 ] || { echo "The app did not start:" >&2; docker logs --tail 30 "$app" >&2; exit 1; }

echo "API integration test..."
DATABASE_URL=postgres://moneyrill:ci-only@127.0.0.1:55432/moneyrill APP_ENV=staging PLAID_ENV=sandbox \
  TEST_BASE_URL=http://127.0.0.1:3099 npx tsx tests/integration.ts
echo "Integration test passed (disposable database removed)."
