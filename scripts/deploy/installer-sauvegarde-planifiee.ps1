# Planifie la sauvegarde nocturne de la base (Tâche planifiée Windows).
# À exécuter en Administrateur.

#Requires -RunAsAdministrator

param(
    [string]$Time = '02:00',
    [int]$KeepDays = 30
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$scriptPath = Join-Path $PSScriptRoot 'sauvegarder-base.ps1'
$taskName = 'Alwatan-Sauvegarde-PostgreSQL'

if (-not (Test-Path $scriptPath)) {
    throw "Script introuvable : $scriptPath"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -KeepDays $KeepDays"

$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -User 'SYSTEM' `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "Tâche planifiée créée : $taskName (tous les jours à $Time)" -ForegroundColor Green
Write-Host "Sauvegardes dans : $(Join-Path $Root 'backups\postgres')"
Write-Host "Conservation : $KeepDays jours"
