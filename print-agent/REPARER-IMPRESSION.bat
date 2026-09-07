@echo off
chcp 65001 >nul
title Alwatan - REPARER USB (tous les ports)
cd /d "%~dp0"
echo.
echo  Teste TOUS les ports USB (pas de reseau).
echo  Nettoie les ports fantomes puis rebranchement.
echo.
set "PS1="
if exist "%~dp0print-agent\scripts\reparer-impression.ps1" set "PS1=%~dp0print-agent\scripts\reparer-impression.ps1"
if exist "%~dp0scripts\reparer-impression.ps1" set "PS1=%~dp0scripts\reparer-impression.ps1"
if not defined PS1 ( echo introuvable & pause & exit /b 1 )
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
