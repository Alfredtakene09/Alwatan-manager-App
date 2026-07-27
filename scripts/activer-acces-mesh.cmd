@echo off
title Alwatan - Acces mesh Tailscale
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0activer-acces-mesh.ps1"
