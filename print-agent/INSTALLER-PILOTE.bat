@echo off
chcp 65001 >nul
title Alwatan - Installer pilote ECO250 / POS-80
cd /d "%~dp0"

echo.
echo  ========================================
echo   Installation pilote E-PoS ECO250
echo   (POS-80 Windows USB)
echo  ========================================
echo.
echo  Droits Administrateur requis (UAC)...
echo.

set "PS1="
if exist "%~dp0print-agent\scripts\install-driver.ps1" set "PS1=%~dp0print-agent\scripts\install-driver.ps1"
if exist "%~dp0scripts\install-driver.ps1" set "PS1=%~dp0scripts\install-driver.ps1"

if not defined PS1 (
  echo [ERREUR] install-driver.ps1 introuvable
  pause
  exit /b 1
)

:: Elevation UAC
net session >nul 2>&1
if errorlevel 1 (
  echo Demande d elevation...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%PS1%"" -AlsoGenericRaw' -Wait"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -AlsoGenericRaw
)

echo.
pause
