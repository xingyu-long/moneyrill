#!/bin/sh
# Prove a backup restores: decrypt the newest backup into a throwaway database and compare row counts.
# Usage: restore-check.sh [production|staging] [file]    (never touches the live database)
set -eu
cd "$(dirname "$0")/.."
PATH="$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
environment="${1:-production}"
file="${2:-$(ls -1t backups/encrypted/"$environment"-*.dump.enc | head -1)}"
compose() {
 case "$environment" in
  staging) docker compose "$@";;
  production) APP_IMAGE="$(cat .releases/production-image)" docker compose --env-file .env.production -f compose.production.yaml "$@";;
 esac
}
q="SELECT (SELECT count(*) FROM accounts)||' accounts, '||(SELECT count(*) FROM balance_snapshots)||' balances, '||(SELECT count(*) FROM holding_snapshots)||' holdings, '||(SELECT count(*) FROM connections)||' connections'"
# Run in the database container as its own user (see scripts/instance.sh); $1 is the command.
pg() { compose exec -T db sh -c "$1"; }
trap 'pg "dropdb -U \"\$POSTGRES_USER\" --if-exists restore_check" >/dev/null 2>&1 || true' EXIT
pg 'dropdb -U "$POSTGRES_USER" --if-exists restore_check'
pg 'createdb -U "$POSTGRES_USER" restore_check'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:secrets/backup.key -in "$file" | pg 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner'
printf 'Backup file: %s\n' "$file"
printf 'Restored : %s\n' "$(pg "psql -U \"\$POSTGRES_USER\" -d restore_check -Atc \"$q\"")"
printf 'Live     : %s\n' "$(pg "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"$q\"")"
