@echo off
:: Installation production Alwatan (Administrateur requis)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-production.ps1" %*
pause
