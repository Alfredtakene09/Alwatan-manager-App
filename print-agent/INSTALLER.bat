@echo off
chcp 65001 >nul
title Alwatan - Installer impression ticket
cd /d "%~dp0"

echo.
echo  ========================================
echo   Alwatan - Agent impression ECO250
echo  ========================================
echo.

set "PS1="
if exist "%~dp0print-agent\scripts\install-agent.ps1" set "PS1=%~dp0print-agent\scripts\install-agent.ps1"
if exist "%~dp0scripts\install-agent.ps1" set "PS1=%~dp0scripts\install-agent.ps1"
if exist "%~dp0install-agent.ps1" set "PS1=%~dp0install-agent.ps1"

if not defined PS1 (
  echo [ERREUR] Script install-agent.ps1 introuvable.
  echo.
  echo Copiez le dossier COMPLET "print-agent" ^(avec scripts, lib, server.mjs^)
  echo ou le dossier "acces-client" entier, puis relancez ce fichier.
  echo.
  echo Dossier actuel : %~dp0
  echo.
  pause
  exit /b 1
)

echo  Script : %PS1%
echo  1^) Node.js doit etre installe
echo  2^) Imprimante USB allumee
echo  3^) Installation de l'agent local...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo [ERREUR] Installation echouee ^(code %ERR%^).
  echo Lancez aussi DIAGNOSTIC-IMPRESSION.bat pour plus de details.
)
pause
exit /b %ERR%
