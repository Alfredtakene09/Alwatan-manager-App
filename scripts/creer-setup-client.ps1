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
if (-not $ServerIp) {
    $ServerIp = Get-LocalLanIpv4
}
if (-not $ServerIp) {
    $ServerIp = Read-Host 'IP du serveur Alwatan pour ce package (ex. 192.168.1.50)'
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
    'lancer-client.ps1',
    'installer-poste-client.ps1',
    'tester-poste-client.ps1',
    'alwatan-server.txt.example'
)
foreach ($file in $filesFromScripts) {
    Copy-Item (Join-Path $PSScriptRoot $file) (Join-Path $packageDir $file) -Force
}
Copy-Item $icon (Join-Path $packageDir 'alwatan.ico') -Force

Set-Content -Path (Join-Path $packageDir 'alwatan-server.txt') -Value "SERVER_IP=$ServerIp" -Encoding UTF8

Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client' -ScriptsDir $packageDir | Out-Null

$installerBat = @"
@echo off
title Installation Alwatan Manager (client)
cd /d "%~dp0"
echo.
echo   Clinique Alwatan — Installation poste client
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-poste-client.ps1"
if errorlevel 1 (
    echo.
    echo Installation echouee.
    pause
    exit /b 1
)
"@
Set-Content -Path (Join-Path $packageDir 'INSTALLER.bat') -Value $installerBat -Encoding ASCII

$lisezMoi = @"
Clinique Alwatan — Setup client (accès réseau)
==============================================

Sur ce PC (réception, médecin, etc.) — pas le serveur :

1. Copiez tout le dossier « $packageName » (clé USB ou réseau).
2. Double-cliquez sur INSTALLER.bat
3. Validez l'IP du serveur si demandée (défaut : $ServerIp)
4. Utilisez le raccourci Bureau « Alwatan Manager »

URL après installation : http://${ServerIp}:${Port}/

Prérequis : Windows 10/11, Edge ou Chrome, même réseau local que le serveur.
Le serveur doit être allumé (service AlwatanManager sur le port $Port).

Dépannage : lancez tester-poste-client.ps1 (clic droit → Exécuter avec PowerShell)
ou modifiez alwatan-server.txt avant de réinstaller.
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
Write-Host ''
Write-Host 'Distribuez le ZIP ou le dossier sur les postes clients, puis INSTALLER.bat' -ForegroundColor Cyan
Write-Host ''

if (-not $Quiet) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Setup client créé.`n`nZIP :`n$zipPath`n`nCopiez-le sur les autres PC et lancez INSTALLER.bat"
}
