@echo off
title Alwatan Manager - Préparation poste client
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparer-poste-client.ps1"
pause
