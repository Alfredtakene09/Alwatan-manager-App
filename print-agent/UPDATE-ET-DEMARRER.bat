@echo off
chcp 65001 >nul
title Alwatan - Mettre a jour AppData + demarrer agent
cd /d "%~dp0"

echo.
echo  Met a jour les fichiers dans AppData
echo  puis demarre l'agent 127.0.0.1:19100
echo.

set "PS1="
if exist "%~dp0print-agent\scripts\update-et-demarrer.ps1" set "PS1=%~dp0print-agent\scripts\update-et-demarrer.ps1"
if exist "%~dp0scripts\update-et-demarrer.ps1" set "PS1=%~dp0scripts\update-et-demarrer.ps1"

if not defined PS1 (
  echo [ERREUR] update-et-demarrer.ps1 introuvable
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -PrinterName "POS-80"
echo.
pause
