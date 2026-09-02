#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  IntelliCare — Linux / Ubuntu startup script
#  Usage:  bash start.sh
# ─────────────────────────────────────────────────────────────

set -e

# Check Docker is installed
if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed."
  echo "   Install it from: https://docs.docker.com/engine/install/ubuntu/"
  exit 1
fi

if ! docker compose version &> /dev/null && ! docker-compose version &> /dev/null; then
  echo "❌ Docker Compose is not installed."
  echo "   Install it from: https://docs.docker.com/compose/install/"
  exit 1
fi

# Create .env from template if missing
if [ ! -f .env ]; then
  echo "📝 .env not found — creating from .env.docker..."
  cp .env.docker .env
  echo "   ⚠️  Edit .env to set your own passwords, JWT_SECRET and SESSION_SECRET before production use."
fi

echo ""
echo "🚀 Starting IntelliCare HMIS..."
echo "   Building Docker image (first run takes 3-5 minutes)..."
echo ""

# Use 'docker compose' (v2) or fall back to 'docker-compose' (v1)
if docker compose version &> /dev/null 2>&1; then
  docker compose up --build -d
else
  docker-compose up --build -d
fi

echo ""
echo "✅ IntelliCare is running!"
echo ""
echo "   🌐 Open in browser:  http://localhost:3002"
echo "   📋 View logs:        docker compose logs -f app"
echo "   🛑 Stop:             docker compose down"
echo ""
