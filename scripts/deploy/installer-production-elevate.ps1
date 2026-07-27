# Relance installer-production.ps1 avec élévation UAC si nécessaire.
param(
    [switch]$SkipBuild,
    [switch]$SkipFirewall,
    [switch]$SkipBackupTask,
    [int]$Port = 4000,
    [string]$ServiceName = 'AlwatanManager'
)

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal $identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $argList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $PSCommandPath
    )
    if ($SkipBuild) { $argList += '-SkipBuild' }
    if ($SkipFirewall) { $argList += '-SkipFirewall' }
    if ($SkipBackupTask) { $argList += '-SkipBackupTask' }
    if ($Port -ne 4000) {
        $argList += '-Port'
        $argList += "$Port"
    }
    if ($ServiceName -ne 'AlwatanManager') {
        $argList += '-ServiceName'
        $argList += $ServiceName
    }

    Write-Host ''
    Write-Host '  Installation production — droits administrateur requis.' -ForegroundColor Yellow
    Write-Host '  Validez la demande UAC (Oui), puis l''installation continuera.' -ForegroundColor Yellow
    Write-Host ''
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList
    exit 0
}

$installer = Join-Path $PSScriptRoot 'installer-production.ps1'
& $installer @PSBoundParameters
