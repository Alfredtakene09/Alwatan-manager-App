# Installe le démarrage automatique d'Alwatan Manager (poste serveur)
# à l'ouverture de session Windows — plus besoin de lancer le script à la main.
#
# Usage :
#   .\scripts\installer-demarrage-auto.ps1
#   .\scripts\installer-demarrage-auto.ps1 -Uninstall
#   .\scripts\installer-demarrage-auto.ps1 -DelaySeconds 5

param(
    [switch]$Uninstall,
    # Delai minimal apres login (PostgreSQL / pile reseau). Eviter 30s — trop long sur Ethernet.
    [int]$DelaySeconds = 5
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_alwatan-common.ps1"

if ($DelaySeconds -lt 0) { $DelaySeconds = 0 }
if ($DelaySeconds -gt 60) { $DelaySeconds = 60 }

$TaskName = 'Alwatan-Demarrage-Serveur'
# -Boot : demarrage rapide (pas de rebuild / pare-feu / navigateur)
$silentVbs = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-serveur' -ExtraArgs '-Production -Boot'
$launcherCmd = Join-Path $PSScriptRoot 'lancer-serveur.cmd'
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Alwatan Manager (Serveur).lnk'

if (-not (Test-Path $silentVbs)) {
    throw "Lanceur silencieux introuvable : $silentVbs"
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $startupLnk) { Remove-Item $startupLnk -Force }
    Write-Host "Démarrage automatique désinstallé ($TaskName)." -ForegroundColor Green
    exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $startupLnk) { Remove-Item $startupLnk -Force }

# wscript //B = aucune fenêtre
$action = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "//B `"$silentVbs`"" `
    -WorkingDirectory $PSScriptRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Decalage court uniquement (polling PostgreSQL/Ethernet dans -Boot)
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
    -Description 'Démarre Alwatan Manager rapidement à l''ouverture de session (mode -Boot Ethernet)' `
    -Force | Out-Null

Write-Host ''
Write-Host 'Démarrage automatique installé (mode cabinet rapide, port 4000).' -ForegroundColor Green
Write-Host "  Tâche planifiée : $TaskName"
Write-Host "  Déclencheur     : ouverture de session ($env:USERNAME)"
Write-Host "  Délai           : ${DelaySeconds}s (puis attente active PostgreSQL)"
Write-Host "  Mode            : -Production -Boot (sans navigateur / sans rebuild)"
Write-Host "  Lanceur         : $silentVbs"
Write-Host "  Journal         : $env:LOCALAPPDATA\CliniqueAlwatan\server.log"
Write-Host ''
Write-Host 'Au prochain redémarrage, le serveur Alwatan démarrera plus vite.' -ForegroundColor Cyan
Write-Host 'Relance manuelle : raccourci Bureau « Alwatan Manager (Serveur) » (ouvre le navigateur).' -ForegroundColor Cyan
Write-Host 'Pour désinstaller : .\scripts\installer-demarrage-auto.ps1 -Uninstall' -ForegroundColor DarkGray
Write-Host ''
