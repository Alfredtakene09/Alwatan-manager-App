@echo off
REM ============================================================
REM  Clinique Alwatan — Demarrage unique (serveur + clients)
REM  Fonctionne SANS Internet, avec cable Ethernet branche.
REM
REM  - Sur le PC serveur : demarre l'app + affiche l'IP Ethernet
REM  - Sur un PC client  : ouvre l'app via le reseau local
REM ============================================================
cd /d "%~dp0"
title Alwatan Manager
powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0scripts\demarrer-alwatan.ps1" %*
if errorlevel 1 (
  echo.
  echo Echec du demarrage. Verifiez :
  echo   1^) Cable Ethernet branche
  echo   2^) Sur le serveur : PostgreSQL + Node.js installes
  echo   3^) Sur un client : alwatan-server.txt avec SERVER_IP=...
  echo.
  pause
)
