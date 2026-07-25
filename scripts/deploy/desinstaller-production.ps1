# Désinstalle le service / la tâche de démarrage production.

#Requires -RunAsAdministrator

param([string]$ServiceName = 'AlwatanManager')

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\..\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nssm = Join-Path $Root 'runtime\nssm\nssm.exe'

& "$PSScriptRoot\arreter-services.ps1" -ServiceName $ServiceName

if (Test-Path $nssm) {
    & $nssm remove $ServiceName confirm 2>$null | Out-Null
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    sc.exe delete $ServiceName | Out-Null
}

Unregister-ScheduledTask -TaskName 'Alwatan-Demarrage-Production' -Confirm:$false -ErrorAction SilentlyContinue

Write-Host 'Service / tâche de démarrage désinstallés.' -ForegroundColor Green
Write-Host "La tâche de sauvegarde « Alwatan-Sauvegarde-PostgreSQL » est conservée." -ForegroundColor DarkGray
Write-Host "Pour la supprimer : Unregister-ScheduledTask -TaskName Alwatan-Sauvegarde-PostgreSQL -Confirm:`$false"
