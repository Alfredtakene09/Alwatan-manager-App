@echo off
chcp 65001 >nul
title Alwatan - Pas de veille (ecran actif)
cd /d "%~dp0"

echo.
echo  Empêche la veille du PC et l'extinction de l'écran
echo  tant que cette fenêtre reste ouverte.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0NoSleep-PC.ps1"
echo.
pause
