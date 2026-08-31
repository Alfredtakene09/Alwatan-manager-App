@echo off
REM Remise a zero : patients, factures, ventes... (conserve utilisateurs, catalogues, stocks).
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0reinitialiser-a-zero.ps1"
pause
