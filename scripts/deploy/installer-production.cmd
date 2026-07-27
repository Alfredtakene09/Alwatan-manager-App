@echo off
title Alwatan Manager - Installation production
set "DEPLOY=%~dp0"
cd /d "%DEPLOY%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DEPLOY%installer-production-elevate.ps1" %*
if errorlevel 1 pause
