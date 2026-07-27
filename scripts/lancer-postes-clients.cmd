@echo off
title Alwatan Manager - Serveur et postes clients
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer-postes-clients.ps1"
if errorlevel 1 pause
