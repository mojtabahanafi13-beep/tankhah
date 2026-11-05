@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Install Node 22.5+ first. & pause & exit /b 1)
powershell -NoProfile -Command "try{ $r=Invoke-WebRequest -Uri 'http://127.0.0.1:8795/api/health' -UseBasicParsing -TimeoutSec 4; if($r.Content -match 'tankhah'){exit 0}else{exit 1} }catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  echo Tankhah is already running on port 8795 - nothing to do.
  pause
  exit /b 0
)
set PORT=8795
node --no-warnings server.js
pause
