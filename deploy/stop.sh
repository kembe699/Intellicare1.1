#!/bin/bash
cd "$(dirname "$0")"
echo "Stopping IntelliCare HMIS..."
docker compose down
echo "Stopped."
