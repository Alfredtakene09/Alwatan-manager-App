# Crée sur le Bureau les raccourcis Serveur et Client avec le logo alwatan.ico.
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$icon = Ensure-AlwatanIcon -Root $Root
if (-not $icon) {
    Write-Host 'ERREUR : alwatan.ico introuvable.' -ForegroundColor Red
    exit 1
}

$serverLauncher = Join-Path $PSScriptRoot 'lancer-serveur.cmd'
$clientLauncher = Join-Path $PSScriptRoot 'lancer-client.cmd'

$serverShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Serveur)' `
    -LauncherPath $serverLauncher `
    -Description 'Démarrer Alwatan Manager sur ce poste serveur' `
    -IconPath $icon

$clientShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Client)' `
    -LauncherPath $clientLauncher `
    -Description 'Ouvrir Alwatan Manager depuis un poste client' `
    -IconPath $icon

$configPath = Get-AlwatanServerConfigPath
$examplePath = Join-Path $PSScriptRoot 'alwatan-server.txt.example'
if (-not (Test-Path $configPath) -and (Test-Path $examplePath)) {
    Copy-Item $examplePath $configPath
}

Write-Host ''
Write-Host 'Raccourcis créés sur le Bureau :' -ForegroundColor Green
Write-Host "  $serverShortcut"
Write-Host "  $clientShortcut"
Write-Host "  Icône : $icon"
Write-Host ''
Write-Host 'Utilisation :' -ForegroundColor Cyan
Write-Host '  • Poste serveur : double-cliquez sur « Alwatan Manager (Serveur) »'
Write-Host '  • Autres postes : double-cliquez sur « Alwatan Manager (Client) »'
Write-Host ''
Write-Host "Configuration réseau (clients) : $configPath" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Pour les postes sans le projet : exécutez preparer-poste-client.cmd' -ForegroundColor DarkGray
Write-Host ''

Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Les raccourcis ont été recréés sur le Bureau avec l'icône Alwatan.`n`n• Serveur : démarre l'application`n• Client : ouvre l'application (démarre le serveur si besoin sur ce PC)"
