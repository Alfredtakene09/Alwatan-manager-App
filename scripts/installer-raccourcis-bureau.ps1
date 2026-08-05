# Crée sur le Bureau les raccourcis Serveur et Client avec le logo alwatan.ico.
param([switch]$Quiet)

. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$icon = Ensure-AlwatanIcon -Root $Root -Force
if (-not $icon) {
    Write-Host 'ERREUR : alwatan.ico introuvable.' -ForegroundColor Red
    exit 1
}

$serverLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-serveur' -ExtraArgs '-Production'
$serverAutoLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-serveur-auto'
$clientLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client'

$serverShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Serveur)' `
    -LauncherPath $serverLauncher `
    -Description 'Démarrer Alwatan (mode cabinet, port 4000 — réseau / démarrage auto)' `
    -IconPath $icon

$clientShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Client)' `
    -LauncherPath $clientLauncher `
    -Description 'Ouvrir Alwatan Manager depuis un poste client' `
    -IconPath $icon

$serverAutoShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Serveur Auto)' `
    -LauncherPath $serverAutoLauncher `
    -Description 'Mode développeur uniquement (Vite 5173) — ne pas utiliser pour les postes clients' `
    -IconPath $icon

$configPath = Get-AlwatanServerConfigPath
$examplePath = Join-Path $PSScriptRoot 'alwatan-server.txt.example'
if (-not (Test-Path $configPath) -and (Test-Path $examplePath)) {
    Copy-Item $examplePath $configPath
}

Write-Host ''
Write-Host 'Raccourcis créés sur le Bureau :' -ForegroundColor Green
Write-Host "  $serverShortcut"
Write-Host "  $serverAutoShortcut"
Write-Host "  $clientShortcut"
Write-Host "  Icône : $icon"
Write-Host ''
Write-Host 'Utilisation :' -ForegroundColor Cyan
Write-Host '  • Poste serveur (cabinet) : « Alwatan Manager (Serveur) » — port 4000'
Write-Host '  • Développement seul : « Alwatan Manager (Serveur Auto) » — ne pas pour les clients'
Write-Host '  • Autres postes : « Alwatan Manager (Client) »'
Write-Host ''
Write-Host "Configuration réseau (clients) : $configPath" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Pour les postes sans le projet : exécutez creer-setup-client.cmd' -ForegroundColor DarkGray
Write-Host ''

if (-not $Quiet) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Les raccourcis ont été recréés sur le Bureau.`n`n• Serveur : mode cabinet (port 4000) — à utiliser au quotidien et après arrêt`n• Serveur Auto : développement uniquement — pas pour les postes clients`n• Client : ouvrir l'appli depuis un autre PC"
}
