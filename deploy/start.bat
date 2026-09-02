@echo off
title IntelliCare HMIS
cd /d "%~dp0"

echo ========================================
echo   IntelliCare HMIS - Starting...
echo ========================================

docker --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo ERROR: Docker not installed or not running.
    echo Get Docker Desktop from: https://www.docker.com/products/docker-desktop/
    pause & exit /b 1
)

docker image inspect intellicare-app:latest >nul 2>&1
IF ERRORLEVEL 1 (
    echo Loading image...
    IF EXIST intellicare-app.tar.gz (
        docker load -i intellicare-app.tar.gz
    ) ELSE (
        echo ERROR: intellicare-app.tar.gz not found.
        pause & exit /b 1
    )
)

echo Starting containers...
docker compose up -d
IF ERRORLEVEL 1 ( echo ERROR: Failed to start. & pause & exit /b 1 )

REM ── Seed database if empty ─────────────────────────────────────────────────
REM Docker only runs init scripts on a blank volume. This explicitly imports
REM init.sql whenever key tables are empty (handles upgrades and re-runs).
echo Waiting for database to be ready...
set /a TRIES=0
:WAIT_LOOP
set /a TRIES+=1
docker compose exec -T db pg_isready -U hmis_user -d intellicare_hmis >nul 2>&1
IF ERRORLEVEL 1 (
    IF %TRIES% LSS 30 ( timeout /t 2 /nobreak >nul & goto WAIT_LOOP )
)

FOR /F "tokens=*" %%C IN ('docker compose exec -T db psql -U hmis_user -d intellicare_hmis -tAc "SELECT COUNT(*) FROM services;" 2^>nul') DO SET SVC_COUNT=%%C
IF NOT DEFINED SVC_COUNT SET SVC_COUNT=0
IF "%SVC_COUNT%"=="0" (
    echo Importing data: services, inventory, lab tests, users...
    docker compose exec -T db psql -U hmis_user -d intellicare_hmis -f /docker-entrypoint-initdb.d/init.sql
    echo Data imported successfully!
) ELSE (
    echo Database already has data. Skipping import.
)
REM ─────────────────────────────────────────────────────────────────────────

echo.
echo ========================================
echo   Open: http://localhost:3003
echo   Login: kembe699@gmail.com / <the SEED_ADMIN_PASSWORD you set>
echo   Stop: run stop.bat
echo ========================================
echo.
pause >nul
start http://localhost:3003
