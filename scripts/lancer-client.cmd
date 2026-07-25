@echo off
title Alwatan Manager - Client
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer-client.ps1"
if errorlevel 1 pause
