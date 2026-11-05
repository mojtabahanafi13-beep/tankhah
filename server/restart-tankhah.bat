@echo off
rem Restarts ONLY Tankhah (port 8795). The supervisor starts it again within about 15 seconds. Anbar is not touched.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8795 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Tankhah restarting... wait 20 seconds.
timeout /t 20 /nobreak >nul
