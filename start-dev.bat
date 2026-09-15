@echo off
chcp 936 >nul
title Qinghua Dev Server
cd /d "%~dp0"

rem ---- 1. Locate Node (fallback when PATH is stale) ----
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
)
node -v >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js not found. Please install Node 20+ and try again.
  pause
  exit /b 1
)

rem ---- 2. Install deps on first run ----
if not exist "node_modules" (
  echo [i] First run: installing dependencies ^(about 1 minute^)...
  call npm install
  if errorlevel 1 (
    echo [x] Dependency install failed.
    pause
    exit /b 1
  )
)

echo [i] Starting... browser will open http://127.0.0.1:1420
echo [i] To stop: press Ctrl+C in this window, or just close it.
echo.
start "" http://127.0.0.1:1420
call npm run dev
pause
