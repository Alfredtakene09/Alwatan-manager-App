@echo off
title Alwatan Manager - Installation demarrage auto
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-demarrage-auto.ps1" %*
if errorlevel 1 pause
