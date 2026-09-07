@echo off
chcp 65001 >nul
title Alwatan - Diagnostic impression
cd /d "%~dp0"

set "PS1="
if exist "%~dp0print-agent\scripts\diagnostic-impression.ps1" set "PS1=%~dp0print-agent\scripts\diagnostic-impression.ps1"
if exist "%~dp0scripts\diagnostic-impression.ps1" set "PS1=%~dp0scripts\diagnostic-impression.ps1"

if not defined PS1 (
  echo [ERREUR] diagnostic-impression.ps1 introuvable.
  echo Copiez le dossier print-agent complet.
  echo Dossier actuel : %~dp0
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
