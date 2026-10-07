#!/bin/sh
# Encrypted, verified, rotated database backup.
# Usage: backup.sh [production|staging]   (default: production)
# Keep: BACKUP_KEEP=14 (newest N per environment). Also used by deploy.sh and the daily schedule.
set -eu
cd "$(dirname "$0")/.."
PATH="$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
umask 077
environment="${1:-production}"
keep="${BACKUP_KEEP:-14}"
keyfile=secrets/backup.key
mkdir -p backups/encrypted
if [ ! -s "$keyfile" ]; then openssl rand -hex 32 > "$keyfile"; fi

compose() {
 case "$environment" in
  staging) docker compose "$@";;
  production) APP_IMAGE="$(cat .releases/production-image)" docker compose --env-file .env.production -f compose.production.yaml "$@";;
  *) printf '%s\n' 'Usage: backup.sh [production|staging]' >&2; exit 1;;
 esac
}

stamp="$(date +%Y%m%d-%H%M%S)"
tmp="backups/encrypted/.$environment-$stamp.tmp"
final="backups/encrypted/$environment-$stamp.dump.enc"
trap 'rm -f "$tmp"' EXIT

compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$keyfile" -in "$tmp" -out "$final"
rm -f "$tmp"

# Verify: the file must decrypt and be a readable PostgreSQL archive.
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$keyfile" -in "$final" | compose exec -T db pg_restore -l >/dev/null; then
 rm -f "$final"; printf '%s\n' 'Backup verification failed; backup discarded.' >&2; exit 1
fi

# Rotate: keep the newest $keep for this environment.
ls -1t backups/encrypted/"$environment"-*.dump.enc 2>/dev/null | tail -n +"$((keep+1))" | while read -r old; do rm -f "$old"; done

printf '%s Encrypted backup verified: %s (%s)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$final" "$(du -h "$final" | cut -f1)"
printf '%s\n' "Keep a separate copy of $keyfile and secrets/$([ "$environment" = production ] && echo production.key || echo token.key); neither is in the database backup."
