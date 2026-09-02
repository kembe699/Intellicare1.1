@echo off
REM ─────────────────────────────────────────────────────────────
REM  IntelliCare — Windows startup script
REM  Usage: Double-click start.bat  OR  run from Command Prompt
REM ─────────────────────────────────────────────────────────────

echo.
echo  IntelliCare HMIS — Windows Startup
echo  ====================================
echo.

REM Check Docker is installed
docker --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo         Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
    echo         Make sure to enable WSL2 backend during installation.
    pause
    exit /b 1
)

REM Check Docker Compose
docker compose version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    docker-compose --version >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Docker Compose not found.
        echo         It comes bundled with Docker Desktop — reinstall Docker Desktop.
        pause
        exit /b 1
    )
)

REM Create .env from template if missing
IF NOT EXIST .env (
    echo [INFO] .env not found — copying from .env.docker...
    copy .env.docker .env >nul
    echo [WARN] Edit .env to set your own passwords, JWT_SECRET and SESSION_SECRET before production use.
    echo.
)

echo [INFO] Building and starting IntelliCare...
echo        First run takes 3-5 minutes to build. Please wait.
echo.

docker compose up --build -d 2>nul
IF %ERRORLEVEL% NEQ 0 (
    docker-compose up --build -d
)

echo.
echo  ============================================
echo   IntelliCare is running!
echo.
echo   Open in browser:  http://localhost:3002
echo   View logs:        docker compose logs -f app
echo   Stop:             docker compose down
echo  ============================================
echo.
pause
