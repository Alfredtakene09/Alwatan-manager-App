# Installe le démarrage automatique d'Alwatan Manager (poste serveur)
# à l'ouverture de session Windows — plus besoin de lancer le script à la main.
#
# Usage :
#   .\scripts\installer-demarrage-auto.ps1
#   .\scripts\installer-demarrage-auto.ps1 -Uninstall

param(
    [switch]$Uninstall,
    # Délai après ouverture de session (laisse PostgreSQL démarrer)
    [int]$DelaySeconds = 30
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_alwatan-common.ps1"

$TaskName = 'Alwatan-Demarrage-Serveur'
$launcherCmd = Join-Path $PSScriptRoot 'lancer-serveur.cmd'
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Alwatan Manager (Serveur).lnk'

if (-not (Test-Path $launcherCmd)) {
    throw "Lanceur introuvable : $launcherCmd"
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $startupLnk) { Remove-Item $startupLnk -Force }
    Write-Host "Démarrage automatique désinstallé ($TaskName)." -ForegroundColor Green
    exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $startupLnk) { Remove-Item $startupLnk -Force }

$action = New-ScheduledTaskAction `
    -Execute $launcherCmd `
    -WorkingDirectory $PSScriptRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Décalage pour laisser le réseau / PostgreSQL démarrer
$trigger.Delay = "PT${DelaySeconds}S"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Démarre Alwatan Manager (API + interface) à l''ouverture de session' `
    -Force | Out-Null

Write-Host ''
Write-Host 'Démarrage automatique installé.' -ForegroundColor Green
Write-Host "  Tâche planifiée : $TaskName"
Write-Host "  Déclencheur     : ouverture de session ($env:USERNAME)"
Write-Host "  Délai           : ${DelaySeconds}s (PostgreSQL / réseau)"
Write-Host "  Script          : $launcherCmd"
Write-Host ''
Write-Host 'Au prochain redémarrage, le serveur Alwatan démarrera tout seul.' -ForegroundColor Cyan
Write-Host 'Pour désinstaller : .\scripts\installer-demarrage-auto.ps1 -Uninstall' -ForegroundColor DarkGray
Write-Host ''
