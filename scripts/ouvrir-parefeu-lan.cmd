@echo off
title Alwatan - Pare-feu reseau local
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0deploy\ouvrir-parefeu.ps1','-IncludeDevPorts'"
pause
