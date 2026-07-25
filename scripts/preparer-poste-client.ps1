# Prépare un dossier client portable (Bureau) pour les postes sans le projet complet.
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$icon = Ensure-AlwatanIcon -Root $Root
$desktop = [Environment]::GetFolderPath('Desktop')
$clientDir = Join-Path $desktop 'Alwatan Manager Client'

New-Item -ItemType Directory -Path $clientDir -Force | Out-Null

$filesToCopy = @(
    '_alwatan-common.ps1',
    'lancer-client.ps1',
    'alwatan-server.txt.example'
)

foreach ($file in $filesToCopy) {
    Copy-Item (Join-Path $PSScriptRoot $file) (Join-Path $clientDir $file) -Force
}

$configPath = Join-Path $clientDir 'alwatan-server.txt'
if (-not (Test-Path $configPath)) {
    Copy-Item (Join-Path $clientDir 'alwatan-server.txt.example') $configPath
}

$launcherCmd = @"
@echo off
title Alwatan Manager - Client
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer-client.ps1"
if errorlevel 1 pause
"@
Set-Content -Path (Join-Path $clientDir 'Lancer Alwatan.cmd') -Value $launcherCmd -Encoding ASCII

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $clientDir 'Alwatan Manager (Client).lnk'))
$shortcut.TargetPath = Join-Path $clientDir 'Lancer Alwatan.cmd'
$shortcut.WorkingDirectory = $clientDir
$shortcut.Description = 'Ouvrir Alwatan Manager (poste client)'
if ($icon -and (Test-Path $icon)) {
    $shortcut.IconLocation = "$icon,0"
}
$shortcut.Save()

if ($icon -and (Test-Path $icon)) {
    Copy-Item $icon (Join-Path $clientDir 'alwatan.ico') -Force
}

Write-Host ''
Write-Host 'Dossier client créé :' -ForegroundColor Green
Write-Host "  $clientDir"
Write-Host ''
Write-Host 'Copiez ce dossier sur les postes clients (clé USB, réseau…) puis lancez le raccourci.' -ForegroundColor Cyan
Write-Host "Configurez l'IP du serveur dans alwatan-server.txt si besoin." -ForegroundColor DarkGray
Write-Host ''

Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Dossier client prêt sur le Bureau :`nAlwatan Manager Client`n`nCopiez-le sur les autres postes du cabinet."
