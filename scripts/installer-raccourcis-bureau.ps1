# Crée sur le Bureau les raccourcis Serveur et Client avec le logo alwatan.ico.
param([switch]$Quiet)

. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$icon = Ensure-AlwatanIcon -Root $Root -Force
if (-not $icon) {
    Write-Host 'ERREUR : alwatan.ico introuvable.' -ForegroundColor Red
    exit 1
}

$serverLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-serveur'
$serverAutoLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-serveur-auto'
$clientLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client'

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

$serverAutoShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Serveur Auto)' `
    -LauncherPath $serverAutoLauncher `
    -Description 'Demarrer Alwatan Manager en auto-mise-a-jour (mode developpement)' `
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
Write-Host '  • Poste serveur : double-cliquez sur « Alwatan Manager (Serveur) »'
Write-Host '  • Développement : double-cliquez sur « Alwatan Manager (Serveur Auto) »'
Write-Host '  • Autres postes : double-cliquez sur « Alwatan Manager (Client) »'
Write-Host ''
Write-Host "Configuration réseau (clients) : $configPath" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Pour les postes sans le projet : exécutez creer-setup-client.cmd' -ForegroundColor DarkGray
Write-Host ''

if (-not $Quiet) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Les raccourcis ont été recréés sur le Bureau avec le logo de la clinique.`n`nDouble-clic : ouverture directe de l'application, sans fenêtre noire.`n`n• Serveur : démarre ou ouvre l'application`n• Serveur Auto : mode développement avec auto-mise à jour`n• Client : ouvre l'application sur le réseau"
}
