@echo off
title Alwatan Manager - Serveur
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer-serveur.ps1"
if errorlevel 1 pause
