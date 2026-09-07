@echo off
chcp 65001 >nul
title Alwatan - Diagnostic USB reel
cd /d "%~dp0"
set "PS1="
if exist "%~dp0print-agent\scripts\diagnostic-usb-reel.ps1" set "PS1=%~dp0print-agent\scripts\diagnostic-usb-reel.ps1"
if exist "%~dp0scripts\diagnostic-usb-reel.ps1" set "PS1=%~dp0scripts\diagnostic-usb-reel.ps1"
if not defined PS1 ( echo introuvable & pause & exit /b 1 )
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
