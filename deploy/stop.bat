@echo off
cd /d "%~dp0"
echo Stopping IntelliCare HMIS...
docker compose down
echo Stopped.
pause
