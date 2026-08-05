@echo off
title Alwatan Manager - Ouverture locale
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ouvrir-alwatan-local.ps1" %*
