@echo off
REM ── Linearr Test Environment ────────────────────────────────────────────────
REM Spins up an isolated Linearr + Tunarr stack for testing.
REM Does NOT touch your production data or containers.
REM
REM Usage:
REM   test.bat              Start/rebuild the test environment
REM   test.bat down         Stop and remove test containers
REM   test.bat reset        Stop, wipe test data, and restart fresh
REM   test.bat logs         Tail logs from both containers
REM
REM Access:
REM   Linearr:  http://localhost:8780   (admin / test)
REM   Tunarr:   http://localhost:8001
REM ────────────────────────────────────────────────────────────────────────────

set COMPOSE=docker compose -f docker-compose.test.yml -p linearr-test

if "%1"=="" goto up
if "%1"=="up" goto up
if "%1"=="start" goto up
if "%1"=="down" goto down
if "%1"=="stop" goto down
if "%1"=="reset" goto reset
if "%1"=="logs" goto logs
echo Usage: test.bat [up^|down^|reset^|logs]
exit /b 1

:up
echo Starting Linearr test environment...
%COMPOSE% up --build -d
echo.
echo   Linearr:  http://localhost:8780  (admin / test)
echo   Tunarr:   http://localhost:8001
echo   Data:     .\test-data\
echo.
echo   Stop:     test.bat down
echo   Reset:    test.bat reset
echo   Logs:     test.bat logs
exit /b 0

:down
echo Stopping test containers...
%COMPOSE% down
echo Done. Test data preserved in .\test-data\
exit /b 0

:reset
echo Resetting test environment (wiping all test data)...
%COMPOSE% down
if exist test-data rmdir /s /q test-data
%COMPOSE% up --build -d
echo.
echo   Fresh start at http://localhost:8780
exit /b 0

:logs
%COMPOSE% logs -f
exit /b 0
