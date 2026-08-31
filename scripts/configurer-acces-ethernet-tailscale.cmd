@echo off
title Alwatan - Acces Ethernet + Tailscale
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0configurer-acces-ethernet-tailscale.ps1','-RestartServer'"
pause
