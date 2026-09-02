@echo off
REM ─────────────────────────────────────────────────────────────
REM  IntelliCare HMIS — Reset: wipe all data and re-import fresh
REM  WARNING: This deletes ALL data in the database.
REM  Usage: Double-click reset.bat
REM ─────────────────────────────────────────────────────────────
title IntelliCare HMIS - Reset
cd /d "%~dp0"

echo ========================================
echo   IntelliCare HMIS - RESET
echo   WARNING: All existing data will be
echo   deleted and re-imported from scratch.
echo ========================================
echo.
set /p CONFIRM=Are you sure? Type YES to continue: 
IF NOT "%CONFIRM%"=="YES" ( echo Cancelled. & pause & exit /b 0 )

echo Stopping and removing containers + volumes...
docker compose down -v
IF ERRORLEVEL 1 ( echo ERROR during shutdown. & pause & exit /b 1 )

echo Starting fresh containers...
docker compose up -d
IF ERRORLEVEL 1 ( echo ERROR: Failed to start. & pause & exit /b 1 )

echo Waiting for database to be ready...
set /a TRIES=0
:WAIT_LOOP
set /a TRIES+=1
docker compose exec -T db pg_isready -U hmis_user -d intellicare_hmis >nul 2>&1
IF ERRORLEVEL 1 (
    IF %TRIES% LSS 30 ( timeout /t 2 /nobreak >nul & goto WAIT_LOOP )
)

echo Importing all data (services, inventory, lab tests, users)...
docker compose exec -T db psql -U hmis_user -d intellicare_hmis -f /docker-entrypoint-initdb.d/init.sql
IF ERRORLEVEL 1 ( echo ERROR: Import failed. & pause & exit /b 1 )

echo.
echo ========================================
echo   Reset complete!
echo   Open: http://localhost:3003
echo   Login: kembe699@gmail.com / <the SEED_ADMIN_PASSWORD you set>
echo ========================================
echo.
pause >nul
start http://localhost:3003
