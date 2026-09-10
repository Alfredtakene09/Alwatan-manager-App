@echo off
chcp 65001 >nul
title Test reseau Alwatan - poste pharmacie
echo.
echo  ========================================
echo   Test reseau Alwatan (poste pharmacie)
echo  ========================================
echo.
echo  Adresse IPv4 de CE poste :
ipconfig | findstr /i "IPv4"
echo.

set "HAS_CLINIC=0"
ipconfig | findstr /i "IPv4" | findstr /c:"192.168.88." >nul && set "HAS_CLINIC=1"
ipconfig | findstr /i "IPv4" | findstr /c:"192.168.1." >nul && set "HAS_CLINIC=1"
ipconfig | findstr /i "IPv4" | findstr /c:"100.88." >nul && set "HAS_CLINIC=1"

if "%HAS_CLINIC%"=="0" (
  echo  DIAGNOSTIC : ce PC n'est PAS sur le reseau de la clinique.
  echo.
  echo  Indices :
  echo   - 169.254.x.x  = cable / Wi-Fi sans connexion
  echo   - 192.168.137.x = point d'acces mobile Windows  ^(a desactiver^)
  echo.
  echo  A FAIRE :
  echo   1. Desactiver le point d'acces mobile ^(Parametres ^> Reseau ^> Point d'acces^)
  echo   2. Soit brancher un cable Ethernet au MEME switch que le serveur
  echo   3. Soit cliquer sur l'icone Wi-Fi et rejoindre le Wi-Fi de la clinique
  echo      ^(le serveur est en 192.168.88.161 sur ce Wi-Fi^)
  echo   4. Relancer ce fichier : l'IPv4 doit commencer par 192.168.88. ou 192.168.1.
  echo.
)

echo  Test 1/3  Wi-Fi serveur  192.168.88.161:4000
powershell -NoProfile -Command "if ((Test-NetConnection 192.168.88.161 -Port 4000 -WarningAction SilentlyContinue).TcpTestSucceeded) { Write-Host '  OK  -> ouvrez http://192.168.88.161:4000' -ForegroundColor Green } else { Write-Host '  ECHEC' -ForegroundColor Red }"
echo.
echo  Test 2/3  Cable serveur  192.168.1.175:4000
powershell -NoProfile -Command "if ((Test-NetConnection 192.168.1.175 -Port 4000 -WarningAction SilentlyContinue).TcpTestSucceeded) { Write-Host '  OK  -> ouvrez http://192.168.1.175:4000' -ForegroundColor Green } else { Write-Host '  ECHEC' -ForegroundColor Red }"
echo.
echo  Test 3/3  Tailscale       100.88.27.41:4000
powershell -NoProfile -Command "if ((Test-NetConnection 100.88.27.41 -Port 4000 -WarningAction SilentlyContinue).TcpTestSucceeded) { Write-Host '  OK  -> ouvrez http://100.88.27.41:4000' -ForegroundColor Green } else { Write-Host '  ECHEC' -ForegroundColor Red }"
echo.
pause
