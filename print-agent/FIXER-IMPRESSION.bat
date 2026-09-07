@echo off
chcp 65001 >nul
title Alwatan - FIX DEFINITIF impression
cd /d "%~dp0"
echo.
echo  ========================================
echo   FIX UNIQUE - restaure imprimante + agent
echo   (POS-80 + Alwatan-Ticket-RAW + agent)
echo  ========================================
echo.
echo  Acceptez le UAC Administrateur.
echo.
set "PS1="
if exist "%~dp0print-agent\scripts\fixer-definitif.ps1" set "PS1=%~dp0print-agent\scripts\fixer-definitif.ps1"
if exist "%~dp0scripts\fixer-definitif.ps1" set "PS1=%~dp0scripts\fixer-definitif.ps1"
if not defined PS1 (
  echo Fichier fixer-definitif.ps1 introuvable
  echo Copiez le dossier acces-client COMPLET depuis le serveur.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
