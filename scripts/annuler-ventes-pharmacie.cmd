@echo off
REM Annule / remet a zero les ventes pharmacie (restaure le stock).
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0annuler-ventes-pharmacie.ps1"
pause
