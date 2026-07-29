#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."

echo "[entrypoint] Ensuring persistent application directories exist..."
for dir in "$UPLOADS_DATA_PATH" "$IMPORTS_DATA_PATH" "$EXPORTS_DATA_PATH" "$BACKUPS_DATA_PATH" "$SCRYFALL_CONTAINER_DATA_PATH"; do
  if [ -n "$dir" ]; then
    mkdir -p "$dir"
  fi
done

echo "[entrypoint] Ensuring persistent webhook encryption key exists..."
npm run webhook:key:ensure

if [ "${WIPE_DB_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] WIPE_DB_ON_START=true -> resetting database (destructive)."
  npx prisma migrate reset --force --skip-generate
else
  # Always attempt to clear known failed markers from iterative dev migrations.
  # Safe no-op when they are not in failed state.
  npx prisma migrate resolve --rolled-back 20260522120000_admin_setup >/dev/null 2>&1 || true
  npx prisma migrate resolve --rolled-back 20260524140000_card_json_column_type_compat >/dev/null 2>&1 || true
  npx prisma migrate resolve --rolled-back 20260602150000_trades_system >/dev/null 2>&1 || true
  npx prisma migrate deploy
fi

if [ "${RUN_SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Seeding..."
  npm run prisma:seed
else
  echo "[entrypoint] Skipping seed (RUN_SEED_ON_START=false)."
fi

echo "[entrypoint] Ensuring admin login exists..."
npm run prisma:bootstrap-admin

echo "[entrypoint] Starting web server..."
exec npm run start
