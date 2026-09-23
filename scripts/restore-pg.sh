#!/usr/bin/env bash
# restore-pg.sh — restore a Hub Postgres dump into DATABASE_URL (or PG* vars).
#
# Usage:
#   CONFIRM=1 DATABASE_URL=postgres://... ./scripts/restore-pg.sh backups/hub-....dump
#   CONFIRM=1 ./scripts/restore-pg.sh path/to/dump.sql   # plain SQL via psql
#
# Safety: requires CONFIRM=1 or interactive yes. Overwrites target DB contents.
# Custom-format (-Fc) dumps use pg_restore; .sql / plain use psql.
# Exit non-zero on failure. Requires pg_restore / psql on PATH.
set -euo pipefail

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

dump="${1:-}"
if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "error: dump file required" >&2
  usage
fi

if [[ "${CONFIRM:-}" != "1" ]]; then
  echo "WARNING: restore will overwrite the target database."
  echo "Target: ${DATABASE_URL:-PG* connection}"
  read -r -p "Type 'yes' to continue: " ans
  if [[ "$ans" != "yes" ]]; then
    echo "aborted"
    exit 1
  fi
fi

lower="$(printf '%s' "$dump" | tr '[:upper:]' '[:lower:]')"
if [[ "$lower" == *.sql ]]; then
  echo "restoring plain SQL via psql ← $dump"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql -v ON_ERROR_STOP=1 -f "$dump" "$DATABASE_URL"
  else
    psql -v ON_ERROR_STOP=1 -f "$dump"
  fi
else
  echo "restoring custom dump via pg_restore ← $dump"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    pg_restore --no-owner --no-acl --clean --if-exists -d "$DATABASE_URL" "$dump"
  else
    pg_restore --no-owner --no-acl --clean --if-exists "$dump"
  fi
fi

echo "ok: restore finished"
