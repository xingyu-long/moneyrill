#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
environment="${1:-staging}"
umask 077
mkdir -p secrets .releases
case "$environment" in
 staging)
  if [ ! -f .env ]; then cp .env.example .env; fi
  if [ ! -s secrets/token.key ]; then openssl rand -hex 32 > secrets/token.key; fi
  printf '%s\n' 'Staging ready. Add Sandbox keys to .env if desired.'
  ;;
 production)
  if [ ! -f .env.production ]; then
   cp .env.production.example .env.production
   password="$(openssl rand -hex 24)"
   printf '\nPOSTGRES_PASSWORD=%s\n' "$password" >> .env.production
  fi
  if [ ! -s secrets/production.key ]; then openssl rand -hex 32 > secrets/production.key; fi
  printf '%s\n' 'Production config ready. Add Production keys to .env.production; keep this file and key private.'
  ;;
 *) printf '%s\n' 'Usage: setup.sh staging|production' >&2; exit 1;;
esac
