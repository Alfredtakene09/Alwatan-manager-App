@echo off
title Alwatan Manager - Installation raccourcis
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-raccourcis-bureau.ps1"
pause
