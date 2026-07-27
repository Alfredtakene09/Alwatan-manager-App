@echo off
title Alwatan - Creer le setup client
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0creer-setup-client.ps1" %*
if errorlevel 1 pause
