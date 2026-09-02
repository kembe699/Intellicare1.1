#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  IntelliCare HMIS — Reset: wipe all data and re-import fresh
#  WARNING: This deletes ALL data in the database.
#  Usage: bash reset.sh
# ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")"

echo "========================================"
echo "  IntelliCare HMIS — RESET"
echo "  WARNING: All existing data will be"
echo "  deleted and re-imported from scratch."
echo "========================================"
echo ""
read -p "Are you sure? Type YES to continue: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "Cancelled."
  exit 0
fi

echo "Stopping and removing containers + volumes..."
docker compose down -v

echo "Starting fresh..."
docker compose up -d

echo "Waiting for database to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U hmis_user -d intellicare_hmis &>/dev/null; then
    break
  fi
  sleep 2
done

echo "Importing all data..."
docker compose exec -T db psql -U hmis_user -d intellicare_hmis < database/init.sql

echo ""
echo "========================================"
echo "  Reset complete!"
echo "  Open: http://localhost:3003"
echo "  Login: kembe699@gmail.com / <the SEED_ADMIN_PASSWORD you set>"
echo "========================================"
