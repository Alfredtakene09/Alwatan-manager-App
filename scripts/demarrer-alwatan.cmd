@echo off
REM Demarrage unique Alwatan (serveur OU client) — Ethernet, hors ligne OK.
cd /d "%~dp0"
title Alwatan Manager
powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0demarrer-alwatan.ps1" %*
if errorlevel 1 pause
