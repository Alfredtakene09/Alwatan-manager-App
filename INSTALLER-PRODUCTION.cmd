@echo off
title Alwatan Manager - Installation production
set "ROOT=%~dp0"
cd /d "%ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\deploy\installer-production-elevate.ps1" %*
if errorlevel 1 pause
