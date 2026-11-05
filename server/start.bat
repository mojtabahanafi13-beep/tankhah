@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo تنخواه گردانی - آدرس: http://localhost:3100
node --disable-warning=ExperimentalWarning server.js
pause
