@echo off
chcp 65001 >nul
title Alwatan - Installation COMPLETE impression
cd /d "%~dp0"

echo.
echo  ========================================
echo   INSTALLATION COMPLETE IMPRESSION
echo   Pharmacie + Reception
echo  ========================================
echo.
echo  Ce script installe :
echo    1. Pilote Windows POS-80 (E-PoS ECO250)
echo    2. Agent impression silencieuse
echo    3. Demarrage auto + ticket test
echo.
echo  Preconditions :
echo    - Node.js installe
echo    - Imprimante USB branchee et allumee
echo.

set "PS1="
if exist "%~dp0print-agent\scripts\install-complet.ps1" set "PS1=%~dp0print-agent\scripts\install-complet.ps1"
if exist "%~dp0scripts\install-complet.ps1" set "PS1=%~dp0scripts\install-complet.ps1"

if not defined PS1 (
  echo [ERREUR] install-complet.ps1 introuvable
  echo Copiez le dossier acces-client COMPLET depuis le serveur.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -PrinterName "POS-80"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" echo [ERREUR] code %ERR%
pause
exit /b %ERR%
