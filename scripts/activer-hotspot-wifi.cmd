@echo off
title Alwatan - Hotspot Wi-Fi pour les postes clients
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0activer-hotspot-wifi.ps1"
