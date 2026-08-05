@echo off
REM Lance Alwatan sans fenêtre console (mode cabinet).
cd /d "%~dp0"
wscript.exe //B "%~dp0lancer-serveur-silencieux.vbs"
