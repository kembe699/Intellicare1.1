#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "========================================"
echo "  IntelliCare HMIS — Starting..."
echo "========================================"

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker not installed. Get it from https://docs.docker.com/get-docker/"
  exit 1
fi

# Load image if not already loaded
if ! docker image inspect intellicare-app:latest &>/dev/null; then
  echo "Loading image..."
  if [ -f intellicare-app.tar.gz ]; then
    docker load -i intellicare-app.tar.gz
  else
    echo "ERROR: intellicare-app.tar.gz not found."
    exit 1
  fi
fi

echo "Pulling PostgreSQL (if not cached)..."
docker pull postgres:16-alpine 2>/dev/null || true

echo "Starting containers..."
docker compose up -d

# ── Seed database if empty ──────────────────────────────────────────────────
# Docker only runs init scripts on a blank volume. This block explicitly
# imports init.sql whenever key tables are empty (handles upgrades / re-runs).
echo "Waiting for database to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U hmis_user -d intellicare_hmis &>/dev/null; then
    break
  fi
  sleep 2
done

SVC_COUNT=$(docker compose exec -T db psql -U hmis_user -d intellicare_hmis -tAc \
  "SELECT COUNT(*) FROM services;" 2>/dev/null | tr -d '[:space:]' || echo "0")

if [ "$SVC_COUNT" = "0" ] || [ -z "$SVC_COUNT" ]; then
  echo "Importing data (services, inventory, lab tests, users)..."
  docker compose exec -T db psql -U hmis_user -d intellicare_hmis \
    < database/init.sql
  echo "✅ Data imported successfully!"
else
  echo "✅ Database already has data ($SVC_COUNT services). Skipping import."
fi
# ────────────────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo "  Open: http://localhost:3003"
echo "  Login: kembe699@gmail.com / <the SEED_ADMIN_PASSWORD you set>"
echo "  Stop:  ./stop.sh"
echo "========================================"
