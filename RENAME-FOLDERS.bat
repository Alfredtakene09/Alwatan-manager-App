@echo off
REM Fermez Cursor avant d'executer ce script.
cd /d "%~dp0\.."
echo Renommage du projet en Alwatan-Manager-Pro...
if exist "Alkhoufrane-Manager-Pro" (
  ren "Alkhoufrane-Manager-Pro" "Alwatan-Manager-Pro"
) else if exist "Alwatan-Manager-Pro" (
  echo Le dossier Alwatan-Manager-Pro existe deja.
) else (
  echo Dossier projet introuvable.
  pause
  exit /b 1
)
cd /d "%~dp0\..\.."
echo Renommage du dossier parent en Alwatan...
if exist "Al koufrane" (
  ren "Al koufrane" "Alwatan"
) else if exist "Alwatan" (
  echo Le dossier Alwatan existe deja.
) else (
  echo Dossier parent introuvable.
  pause
  exit /b 1
)
echo Termine. Rouvrez le projet depuis: Desktop\Alwatan\Alwatan-Manager-Pro
pause
