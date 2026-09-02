# IntelliCare HMIS — Docker Deployment Guide

Run the full application (frontend + backend + database) on **any PC** with a single command.

---

## Prerequisites

| Platform | Install |
|----------|---------|
| **Ubuntu / Linux** | [Docker Engine](https://docs.docker.com/engine/install/ubuntu/) + [Docker Compose Plugin](https://docs.docker.com/compose/install/linux/) |
| **Windows** | [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) (includes Compose) — enable WSL2 backend |

---

## Quick Start

### Ubuntu / Linux
```bash
bash start.sh
```

### Windows
Double-click **`start.bat`** or run it from Command Prompt.

---

## Manual Start (both platforms)

```bash
# 1. Copy environment file (first time only)
cp .env.docker .env         # Linux/Mac
copy .env.docker .env       # Windows

# 2. Edit .env — set your own passwords and secrets (see below)

# 3. Build and start all services
docker compose up --build -d

# 4. Open in browser
#    http://localhost:3002
```

---

## Default Login

| Field    | Value                  |
|----------|------------------------|
| Email    | `kembe699@gmail.com`   |
| Password | `<set via SEED_ADMIN_PASSWORD>`           |

> Change this password immediately after first login.

---

## Useful Commands

```bash
# View live logs
docker compose logs -f app

# View database logs
docker compose logs -f db

# Stop everything
docker compose down

# Stop and DELETE all data (⚠ irreversible)
docker compose down -v

# Rebuild after code changes
docker compose up --build -d

# Open a shell inside the app container
docker compose exec app sh

# Connect to the database directly
docker compose exec db psql -U hmis_user -d intellicare_hmis
```

---

## Environment Variables (`.env`)

Copy `.env.docker` to `.env` and edit before first run:

```env
# App port exposed on the host (default: 3002)
APP_PORT=3002

# Database
DB_NAME=intellicare_hmis
DB_USER=hmis_user
DB_PASSWORD=hmis_pass          # ← change this

# Security — MUST change BOTH in production
JWT_SECRET=change_this_to_a_long_random_string
SESSION_SECRET=change_this_too

# CORS — set to your domain in production
CORS_ORIGIN=*

# Redis cache (optional — leave false to use in-memory cache)
REDIS_ENABLED=false
REDIS_URL=
```

> Generate strong secrets with: `openssl rand -hex 32`

---

## Data Persistence

- **Database** is stored in a Docker volume called `pgdata` — survives container restarts.
- **Uploaded files** are stored in a volume called `uploads`.
- To **back up** the database:
  ```bash
  docker compose exec db pg_dump -U hmis_user intellicare_hmis > backup.sql
  ```
- To **restore**:
  ```bash
  cat backup.sql | docker compose exec -T db psql -U hmis_user -d intellicare_hmis
  ```

---

## Ports

| Service  | Host Port | Container Port |
|----------|-----------|----------------|
| App (UI + API) | `3002` (or `$APP_PORT`) | `3002` |
| PostgreSQL | `5433` | `5432` |

> If port `3002` is already in use, set `APP_PORT=3010` (or any free port) in `.env`.

---

## First Build Time

The first `docker compose up --build` downloads base images and installs dependencies:

- **Ubuntu**: ~3–5 minutes
- **Windows**: ~5–8 minutes (WSL2 filesystem overhead)

Subsequent starts take **under 10 seconds**.
