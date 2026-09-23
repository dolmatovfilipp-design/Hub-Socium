#!/usr/bin/env bash
# backup-pg.sh — dump Hub Postgres via DATABASE_URL (or PG* vars).
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/hub ./scripts/backup-pg.sh
#   BACKUP_DIR=/var/backups/hub ./scripts/backup-pg.sh
#
# Output: $BACKUP_DIR/hub-YYYYMMDD-HHMMSS.dump (custom format, pg_dump -Fc)
# Exit non-zero on failure. Requires pg_dump on PATH.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
out="${BACKUP_DIR}/hub-${stamp}.dump"

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "backing up DATABASE_URL → ${out}"
  pg_dump --no-owner --no-acl -Fc -f "$out" "$DATABASE_URL"
else
  echo "backing up via PG* env → ${out}"
  pg_dump --no-owner --no-acl -Fc -f "$out"
fi

if [[ ! -s "$out" ]]; then
  echo "error: dump file missing or empty: $out" >&2
  exit 1
fi

echo "ok: $out ($(wc -c < "$out") bytes)"
