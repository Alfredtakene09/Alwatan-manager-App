@echo off
:: Installe la sauvegarde auto PostgreSQL toutes les 2 h (demande droits Admin).
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0installer-sauvegarde-planifiee.ps1\" -Time 02:00 -IntervalHours 2 -KeepDays 7'"
echo.
pause
