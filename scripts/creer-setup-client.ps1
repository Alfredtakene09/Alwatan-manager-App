# Crée le dossier + ZIP « setup client » à copier sur les autres PC (clé USB, partage réseau).
param(
    [string]$ServerIp = $null,
    [int]$Port = 4000,
    [string]$OutputRoot = $null,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
if (-not $OutputRoot) {
    $OutputRoot = Join-Path $Root 'setup-client'
}

if (-not $ServerIp) {
    $ServerIp = Read-AlwatanServerIp
}
if ($ServerIp -and (Test-AlwatanTailscaleIpv4 $ServerIp)) {
    Write-Host "SERVER_IP=$ServerIp est Tailscale - bascule sur IP Wi-Fi locale." -ForegroundColor Yellow
    $ServerIp = $null
}
if (-not $ServerIp) {
    $ServerIp = Get-LocalLanIpv4
}
if (-not $ServerIp) {
    $ServerIp = Read-Host 'IP Wi-Fi du serveur Alwatan (ex. 192.168.88.161)'
}
if ($ServerIp -and (Test-AlwatanTailscaleIpv4 $ServerIp)) {
    throw "IP principale = Wi-Fi (ex. 192.168.x.x), pas Tailscale ($ServerIp)."
}
$TailscaleIp = Get-TailscaleIpv4
if (-not $TailscaleIp) {
    $TailscaleIp = Read-AlwatanTailscaleIp
}

$packageName = 'Alwatan-Manager-Client'
$packageDir = Join-Path $OutputRoot $packageName
if (Test-Path $packageDir) {
    Remove-Item $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null

$icon = Ensure-AlwatanIcon -Root $Root -Force
if (-not $icon) {
    throw 'Impossible de générer alwatan.ico — vérifiez le logo dans backend\src\assets.'
}

$filesFromScripts = @(
    '_alwatan-common.ps1',
    'demarrer-alwatan.ps1',
    'demarrer-alwatan.cmd',
    'lancer-client.ps1',
    'installer-poste-client.ps1',
    'mise-a-jour-poste-pharmacie.ps1',
    'tester-poste-client.ps1',
    'diagnostic-poste-client.ps1',
    'alwatan-server.txt.example'
)
foreach ($file in $filesFromScripts) {
    Copy-Item (Join-Path $PSScriptRoot $file) (Join-Path $packageDir $file) -Force
}
# PowerShell 5.1 (Windows) lit UTF-8 seulement avec BOM, sinon l'install plante.
$utf8Bom = New-Object System.Text.UTF8Encoding $true
Get-ChildItem -LiteralPath $packageDir -Filter '*.ps1' | ForEach-Object {
    $text = [System.IO.File]::ReadAllText($_.FullName)
    [System.IO.File]::WriteAllText($_.FullName, $text, $utf8Bom)
}
Copy-Item $icon (Join-Path $packageDir 'alwatan.ico') -Force

Write-AlwatanServerConfig -ServerIp $ServerIp -TailscaleIp $TailscaleIp -Path (Join-Path $packageDir 'alwatan-server.txt')
Update-AlwatanSilentLauncher -ScriptBaseName 'demarrer-alwatan' -ScriptsDir $packageDir | Out-Null
Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client' -ScriptsDir $packageDir | Out-Null

$url = "http://${ServerIp}:${Port}/"
$tsUrl = if ($TailscaleIp -and $TailscaleIp -ne $ServerIp) { "http://${TailscaleIp}:${Port}/" } else { $null }

$lienLines = @("Ethernet : $($url.TrimEnd('/'))")
if ($tsUrl) { $lienLines += "Tailscale (secours) : $($tsUrl.TrimEnd('/'))" }
[System.IO.File]::WriteAllText(
    (Join-Path $packageDir 'LIEN-SERVEUR.txt'),
    ($lienLines -join "`r`n"),
    [System.Text.UTF8Encoding]::new($false)
)

$ouvrirBat = @"
@echo off
title Alwatan Manager
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demarrer-alwatan.ps1" -Mode Client
if errorlevel 1 pause
"@
Set-Content -LiteralPath (Join-Path $packageDir 'DEMARRER-ALWATAN.cmd') -Value $ouvrirBat -Encoding ASCII
Set-Content -LiteralPath (Join-Path $packageDir 'Ouvrir Alwatan.bat') -Value $ouvrirBat -Encoding ASCII

$ouvrirHardBat = @"
@echo off
title Alwatan Manager (rechargement force)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demarrer-alwatan.ps1" -Mode Client -ForceHardReload
if errorlevel 1 pause
"@
Set-Content -LiteralPath (Join-Path $packageDir 'Ouvrir Alwatan (rechargement force).bat') -Value $ouvrirHardBat -Encoding ASCII

$majPharmacieBat = @"
@echo off
title Alwatan - Mise a jour poste Pharmacie
cd /d "%~dp0"
echo.
echo   Mise a jour Pharmacie : raccourci + impression Edge (sans agent)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Include *.ps1,*.cmd,*.bat -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mise-a-jour-poste-pharmacie.ps1"
if errorlevel 1 (
  echo.
  echo Echec. Verifiez le cable reseau et que le serveur Alwatan est allume.
  pause
  exit /b 1
)
echo.
pause
"@
Set-Content -LiteralPath (Join-Path $packageDir 'METTRE-A-JOUR-PHARMACIE.cmd') -Value $majPharmacieBat -Encoding ASCII

$installerBat = @"
@echo off
title Installation Alwatan Manager (client)
cd /d "%~dp0"
echo.
echo   Clinique Alwatan - Installation poste client
echo.
del /q "%~dp0INSTALL-OK.txt" 2>nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Filter *.ps1 -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0installer-poste-client.ps1" > "%~dp0INSTALL-LOG.txt" 2>&1
if exist "%~dp0INSTALL-OK.txt" (
    echo.
    echo Installation OK. Raccourcis : Alwatan Manager + Alwatan Manager (direct)
    pause
    exit /b 0
)
echo.
echo Installation echouee.
echo Ouvrez INSTALL-LOG.txt ou lancez DIAGNOSTIC.bat
echo puis rapportez RAPPORT-ALWATAN-CLIENT.txt sur le serveur.
start "" notepad.exe "%~dp0INSTALL-LOG.txt"
pause
exit /b 1
"@
Set-Content -Path (Join-Path $packageDir 'INSTALLER.bat') -Value $installerBat -Encoding ASCII

$diagnosticBat = @"
@echo off
title Diagnostic Alwatan (poste client)
cd /d "%~dp0"
echo.
echo   Diagnostic Alwatan - creation du rapport...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostic-poste-client.ps1"
if errorlevel 1 (
    echo.
    echo Probleme detecte. Rapportez RAPPORT-ALWATAN-CLIENT.txt sur le serveur.
    pause
)
"@
Set-Content -Path (Join-Path $packageDir 'DIAGNOSTIC.bat') -Value $diagnosticBat -Encoding ASCII

$lisezMoi = @"
Clinique Alwatan - Setup client (Ethernet, hors ligne)
======================================================

Sur ce PC (reception, medecin, etc.) - pas le serveur :

1. Copiez tout le dossier $packageName (cle USB ou reseau).
2. POSTE PHARMACIE (impression Edge, sans agent) :
   Double-cliquez sur METTRE-A-JOUR-PHARMACIE.cmd
3. Autres postes : double-cliquez sur INSTALLER.bat
4. Validez l'IP Ethernet du serveur si demandee (defaut : $ServerIp)
5. Utilisez le raccourci Bureau « Alwatan Manager »
   ou DEMARRER-ALWATAN.cmd

SECOURS immediat (sans installation) :
  DEMARRER-ALWATAN.cmd / Ouvrir Alwatan.bat
  Ouvrir Alwatan (rechargement force).bat

Ethernet : $url
Tailscale (secours) : $(if ($tsUrl) { $tsUrl } else { '(non detecte)' })

Prerequis : Windows 10/11, Edge ou Chrome.
Le serveur doit etre allume (port $Port).
Cable Ethernet branche = meme reseau, pas besoin d'Internet.
"@
Set-Content -Path (Join-Path $packageDir 'LISEZMOI.txt') -Value $lisezMoi -Encoding UTF8

$zipPath = Join-Path $OutputRoot "$packageName.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $packageDir -DestinationPath $zipPath -Force

# Copie aussi vers acces-client pour partage simple depuis le serveur
$accesDir = Join-Path $Root 'acces-client'
New-Item -ItemType Directory -Path $accesDir -Force | Out-Null
Copy-Item -Path (Join-Path $packageDir '*') -Destination $accesDir -Recurse -Force

Write-Host ''
Write-Host '  Package client prêt' -ForegroundColor Green
Write-Host "  Dossier : $packageDir"
Write-Host "  ZIP     : $zipPath"
Write-Host "  Copie   : $accesDir"
Write-Host "  Ethernet : $url"
if ($tsUrl) { Write-Host "  Tailscale (secours) : $tsUrl" }
Write-Host ''
Write-Host 'Distribuez le ZIP ou le dossier sur les postes clients, puis INSTALLER.bat' -ForegroundColor Cyan
Write-Host 'Ou lancez DEMARRER-ALWATAN.cmd directement (hors ligne OK).' -ForegroundColor Cyan
Write-Host ''

if (-not $Quiet) {
    $msgTs = if ($tsUrl) { "`nTailscale : $tsUrl" } else { '' }
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Setup client cree.`n`nZIP :`n$zipPath`n`nEthernet : $url$msgTs`n`nCopiez-le sur les autres PC et lancez INSTALLER.bat"
}
