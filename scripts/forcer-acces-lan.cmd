@echo off
title Alwatan - Forcer acces reseau LAN
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0deploy\forcer-acces-lan.ps1'"
pause
