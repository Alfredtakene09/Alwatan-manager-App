# Crée sur le Bureau le raccourci unique « Alwatan Manager ».
# Serveur et clients : meme demarrage (detection auto).
param([switch]$Quiet)

. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$icon = Ensure-AlwatanIcon -Root $Root -Force
if (-not $icon) {
    Write-Host 'ERREUR : alwatan.ico introuvable.' -ForegroundColor Red
    exit 1
}

$mainLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'demarrer-alwatan'
$serverLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-serveur' -ExtraArgs '-Production'
$clientLauncher = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client'

$mainShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager' `
    -LauncherPath $mainLauncher `
    -Description 'Demarrer Alwatan (serveur ou client — Ethernet, hors ligne)' `
    -IconPath $icon

# Raccourcis avances (optionnels) — utiles si on force un role
$serverShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Serveur)' `
    -LauncherPath $serverLauncher `
    -Description 'Forcer demarrage serveur cabinet (port 4000)' `
    -IconPath $icon

$clientShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Client)' `
    -LauncherPath $clientLauncher `
    -Description 'Forcer ouverture client reseau' `
    -IconPath $icon

# Supprimer l'ancien raccourci « Serveur Auto » (dev) qui creait de la confusion
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($obsolete in @(
    'Alwatan Manager (Serveur Auto).lnk',
    'Ouvrir Alwatan (reseau).lnk',
    'Ouvrir Alwatan (reseau).url',
    'Ouvrir Alwatan (reseau).bat',
    'Alwatan Manager (Wi-Fi).url'
)) {
    $p = Join-Path $desktop $obsolete
    if (Test-Path $p) {
        Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    }
}

$configPath = Get-AlwatanServerConfigPath
$examplePath = Join-Path $PSScriptRoot 'alwatan-server.txt.example'
if (-not (Test-Path $configPath) -and (Test-Path $examplePath)) {
    Copy-Item $examplePath $configPath
}

Write-Host ''
Write-Host 'Raccourcis crees sur le Bureau :' -ForegroundColor Green
Write-Host "  $mainShortcut   <- utiliser celui-ci"
Write-Host "  $serverShortcut"
Write-Host "  $clientShortcut"
Write-Host "  Icone : $icon"
Write-Host ''
Write-Host 'Utilisation (sans Internet) :' -ForegroundColor Cyan
Write-Host '  1) Cable Ethernet branche, IP affichee'
Write-Host '  2) Double-clic « Alwatan Manager » (ou DEMARRER-ALWATAN.cmd)'
Write-Host '  3) Sur le serveur : l''app demarre + IP Ethernet affichee'
Write-Host '  4) Sur les clients : l''app s''ouvre sur cette IP'
Write-Host ''
Write-Host "Config clients : $configPath" -ForegroundColor DarkGray
Write-Host ''

if (-not $Quiet) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Raccourci principal : « Alwatan Manager »

Fonctionne hors ligne avec Ethernet :
• PC serveur = demarre l'application
• PC client  = ouvre l'application sur le reseau

Aussi disponible : DEMARRER-ALWATAN.cmd a la racine du projet.
"@
}
