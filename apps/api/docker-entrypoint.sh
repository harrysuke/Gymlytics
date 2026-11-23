#!/bin/sh
# Container entrypoint: migrate, seed a brand-new SQLite file, then start the API.
set -eu

database_url="${DATABASE_URL:-file:/data/gymlytics.db}"
db_file=""
case "$database_url" in
  file:*) db_file="${database_url#file:}" ;;
esac

# Detect a fresh database BEFORE migrating — the migrator creates the file.
fresh=0
if [ -n "$db_file" ]; then
  mkdir -p "$(dirname "$db_file")"
  [ -f "$db_file" ] || fresh=1
fi

echo "[gymlytics] applying database migrations..."
pnpm --filter @gymlytics/db migrate

if [ "$fresh" -eq 1 ]; then
  echo "[gymlytics] new database detected — seeding demo academy..."
  pnpm --filter @gymlytics/db seed
else
  echo "[gymlytics] existing database found — skipping seed"
fi

echo "[gymlytics] starting API on ${API_HOST:-0.0.0.0}:${API_PORT:-3000}"
exec pnpm --filter @gymlytics/api exec tsx src/main.ts
