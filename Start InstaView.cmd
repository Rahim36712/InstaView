@echo off
title InstaView Launcher
setlocal
set "PORT=8765"
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3 from python.org and try again.
  pause
  exit /b 1
)

rem If InstaView is already being served on the port, don't start a second server
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:%PORT%/viewer/index.html|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
  start "InstaView server (close this window to stop it)" /min python -m http.server %PORT% --bind 127.0.0.1
  ping -n 2 127.0.0.1 >nul
)

start "" "http://localhost:%PORT%/viewer/"
endlocal
