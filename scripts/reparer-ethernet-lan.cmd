@echo off
title Alwatan - Reparer acces Ethernet
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0reparer-ethernet-lan.ps1'"
echo.
echo Si la fenetre Admin s'est fermee sans erreur, testez depuis un PC cable :
echo   http://192.168.1.175:4000
echo.
pause
