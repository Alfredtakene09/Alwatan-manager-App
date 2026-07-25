# Démarre le service / processus production Alwatan.

#Requires -RunAsAdministrator

param([string]$ServiceName = 'AlwatanManager')

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$wrapperCmd = Join-Path $Root 'runtime\start-production.cmd'

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -ne 'Running') {
        Start-Service -Name $ServiceName
        Write-Host "Service $ServiceName démarré." -ForegroundColor Green
    } else {
        Write-Host "Service $ServiceName déjà actif." -ForegroundColor Yellow
    }
    exit 0
}

if (Test-Path $wrapperCmd) {
    Start-Process -FilePath $wrapperCmd -WindowStyle Hidden
    Write-Host 'Processus production démarré (mode tâche planifiée).' -ForegroundColor Green
} else {
    throw "Aucun service ni wrapper trouvé. Lancez d'abord installer-production.ps1"
}
