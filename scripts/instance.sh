# Sourced by the scripts. The name of this installation: INSTANCE_NAME in the environment file (default moneyrill).
# It names the Docker Compose projects (<name>-staging, <name>-production), their database volumes
# (<name>-staging_database, ...) and the PostgreSQL user and database inside them. Changing it on an existing
# installation points it at a new, empty database, so deploy.sh refuses when another installation's volume exists.
env_file() { case "$1" in production) echo .env.production ;; *) echo .env ;; esac; }
instance_name() { # $1 = staging | production
  v="$(grep -E '^INSTANCE_NAME=' "$(env_file "$1")" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' "'"'")"
  v="${v:-moneyrill}"
  case "$v" in -* | *[!a-z0-9-]*) echo "INSTANCE_NAME must be lower-case letters, digits and dashes (got '$v')." >&2; exit 1 ;; esac
  printf '%s' "$v"
}
env_port() { # $1 = staging | production: the port published on this computer. STAGING_PORT / PRODUCTION_PORT from the environment's own file, else from .env
  case "$1" in production) key=PRODUCTION_PORT; default=3003 ;; *) key=STAGING_PORT; default=3002 ;; esac
  v=
  for f in "$(env_file "$1")" .env; do
    v="$(grep -E "^$key=" "$f" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' "'"'")"
    [ -z "$v" ] || break
  done
  v="${v:-$default}"
  case "$v" in *[!0-9]*) echo "$key must be a port number from 1024 to 65535 (got '$v')." >&2; exit 1 ;; esac
  [ "$v" -ge 1024 ] && [ "$v" -le 65535 ] || { echo "$key must be a port number from 1024 to 65535 (got '$v')." >&2; exit 1; }
  printf '%s' "$v"
}
