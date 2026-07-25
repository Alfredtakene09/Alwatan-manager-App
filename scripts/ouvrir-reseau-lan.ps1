# Ouvre le pare-feu Windows pour l'accès LAN (API 4000 + Vite 5173).
# Demande l'élévation Administrateur si nécessaire.

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'alwatan-firewall.log'

function Write-Log([string]$Message) {
    $line = "$(Get-Date -Format 'HH:mm:ss') $Message"
    Add-Content -Path $log -Value $line -Encoding UTF8
    Write-Host $Message
}

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host 'Elevation Administrateur requise pour ouvrir le pare-feu...'
    $self = $MyInvocation.MyCommand.Path
    $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -PassThru -Wait -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$self`""
    )
    exit $p.ExitCode
}

Set-Content -Path $log -Value "Debut ouverture pare-feu Alwatan" -Encoding UTF8

foreach ($port in @(4000, 5173)) {
    $name = "Alwatan Manager LAN TCP $port"
    $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    if ($existing) {
        Enable-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
        Write-Log "Regle deja presente / reactivee : $name"
        continue
    }

    New-NetFirewallRule `
        -DisplayName $name `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $port `
        -Profile Any `
        -Description "Acces reseau local Clinique Alwatan Manager (TCP $port)" | Out-Null

    Write-Log "Regle creee : $name (TCP $port, tous profils)"
}

Write-Log 'OK — ports 4000 et 5173 ouverts pour le LAN.'
exit 0
