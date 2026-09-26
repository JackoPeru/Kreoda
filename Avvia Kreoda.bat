@echo off
setlocal
cd /d "%~dp0"

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo [errore] pnpm.cmd non trovato nel PATH.
  pause
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [errore] node.exe non trovato nel PATH.
  pause
  exit /b 1
)

call pnpm.cmd dev
set "exitCode=%ERRORLEVEL%"
if not "%exitCode%"=="0" echo Kreoda terminato con codice %exitCode%.
pause
exit /b %exitCode%
