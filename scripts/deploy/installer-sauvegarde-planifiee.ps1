# Planifie la sauvegarde automatique de la base (Tache planifiee Windows).
# Defaut : toutes les 2 heures (secours si le process API est arrete).
# A executer en Administrateur.

#Requires -RunAsAdministrator

param(
    [string]$Time = '02:00',
    [int]$IntervalHours = 2,
    [int]$KeepDays = 7
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

# Declenchement journalier a $Time, puis repetition toutes les N heures pendant 24 h.
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$interval = New-TimeSpan -Hours ([Math]::Max(1, $IntervalHours))
$duration = New-TimeSpan -Hours 24
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $Time -RepetitionInterval $interval -RepetitionDuration $duration).Repetition

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

Write-Host "Tache planifiee creee : $taskName (toutes les $IntervalHours h, debut $Time)" -ForegroundColor Green
Write-Host "Sauvegardes dans : $(Join-Path $Root 'backups\postgres')"
Write-Host "Conservation : $KeepDays jours"
Write-Host "Note : le backend Node lance aussi une sauvegarde toutes les 2 h (module data-backup)."
