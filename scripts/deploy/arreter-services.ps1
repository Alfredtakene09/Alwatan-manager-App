# Arrête le service / processus production Alwatan.

#Requires -RunAsAdministrator

param([string]$ServiceName = 'AlwatanManager')

$ErrorActionPreference = 'Continue'

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Stop-Service -Name $ServiceName -Force
    Write-Host "Service $ServiceName arrêté." -ForegroundColor Green
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -like '*Alwatan-manager-App*backend*dist*index.js*' -or
            $_.CommandLine -like '*start-production.ps1*'
        )
    } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Processus arrêté : PID $($_.ProcessId)"
    }

Write-Host 'Terminé.'
