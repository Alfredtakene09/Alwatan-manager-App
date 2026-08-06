@echo off
title Alwatan - Reparer impression ticket
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reparer-impression-ticket-client.ps1"
pause
