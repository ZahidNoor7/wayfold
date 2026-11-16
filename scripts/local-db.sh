#!/usr/bin/env bash
# Project-local PostgreSQL cluster for development and tests.
# Lives in .local/pg (gitignored) on port 54329 so it never touches any other
# PostgreSQL instance on the machine.
#
#   scripts/local-db.sh start    initialise (first run) and start
#   scripts/local-db.sh stop     stop
#   scripts/local-db.sh status   is it running?
#   scripts/local-db.sh destroy  stop and delete the cluster
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/.local/pg"
PORT="${WAYFOLD_PG_PORT:-54329}"
OWNER_PASSWORD="wf_owner_local"

case "${1:-}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"
      initdb -D "$DATA" -U postgres --auth=scram-sha-256 --pwfile=<(printf 'postgres_local') >/dev/null
      {
        echo "port = $PORT"
        echo "listen_addresses = '127.0.0.1'"
        echo "unix_socket_directories = ''"
        echo "max_connections = 400"
      } >> "$DATA/postgresql.conf"
    fi
    if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
      pg_ctl -D "$DATA" -l "$DATA/server.log" -w start >/dev/null
    fi
    export PGPASSWORD=postgres_local
    # Schema owner mirrors a hosted setup: not a superuser, may create roles.
    psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wf_owner') THEN
    CREATE ROLE wf_owner LOGIN PASSWORD '$OWNER_PASSWORD' NOSUPERUSER CREATEDB CREATEROLE;
  END IF;
END \$\$;
SQL
    echo "postgres://wf_owner:$OWNER_PASSWORD@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    pg_ctl -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true
    ;;
  status)
    pg_ctl -D "$DATA" status >/dev/null 2>&1 && echo running || { echo stopped; exit 1; }
    ;;
  destroy)
    pg_ctl -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$DATA"
    ;;
  *)
    echo "usage: $0 start|stop|status|destroy" >&2
    exit 2
    ;;
esac
