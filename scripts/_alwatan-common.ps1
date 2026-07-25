# Fonctions partagées — lanceurs Alwatan Manager
$ErrorActionPreference = 'Continue'

function Get-AlwatanRoot {
    if ($env:ALWATAN_APP_ROOT -and (Test-Path $env:ALWATAN_APP_ROOT)) {
        return (Resolve-Path $env:ALWATAN_APP_ROOT).Path
    }
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-NodeDir {
    $candidates = @(
        'C:\Program Files\nodejs',
        'C:\Program Files (x86)\nodejs'
    )
    foreach ($dir in $candidates) {
        if (Test-Path (Join-Path $dir 'node.exe')) { return $dir }
    }
    return $null
}

function Initialize-NodePath {
    $nodeDir = Get-NodeDir
    if (-not $nodeDir) {
        throw "Node.js introuvable. Installez Node.js depuis https://nodejs.org"
    }
    $env:Path = "$nodeDir;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    return $nodeDir
}

function Get-LocalLanIpv4 {
    # Préférer le Wi-Fi / Ethernet clinique, ignorer le hotspot Windows (192.168.137.x)
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.IPAddress -notlike '192.168.137.*' -and
            $_.PrefixOrigin -ne 'WellKnown'
        }

    $preferred = $candidates |
        Where-Object {
            $_.InterfaceAlias -match 'Wi-?Fi|Ethernet|WLAN|LAN'
        } |
        Sort-Object -Property InterfaceMetric |
        Select-Object -ExpandProperty IPAddress -First 1

    if ($preferred) { return $preferred }

    return $candidates |
        Sort-Object -Property InterfaceMetric |
        Select-Object -ExpandProperty IPAddress -First 1
}

function Get-AlwatanServerConfigPath {
    Join-Path $PSScriptRoot 'alwatan-server.txt'
}

function Read-AlwatanServerIp {
    $path = Get-AlwatanServerConfigPath
    if (-not (Test-Path $path)) { return $null }

    foreach ($line in Get-Content $path -ErrorAction SilentlyContinue) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match '^(?:SERVER_IP\s*=\s*)?([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*$') {
            return $Matches[1]
        }
        if ($trimmed -match '^SERVER_IP\s*=\s*(.+)$') {
            $value = $Matches[1].Trim()
            if ($value) { return $value }
        }
    }
    return $null
}

function Get-AlwatanServerCandidates {
    param([string[]]$ExtraHosts = @())

    $hosts = [System.Collections.Generic.List[string]]::new()
    $seen = @{}

    function Add-HostCandidate([string]$Value) {
        if (-not $Value) { return }
        $key = $Value.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { return }
        $seen[$key] = $true
        [void]$hosts.Add($Value)
    }

    $configured = Read-AlwatanServerIp
    Add-HostCandidate $configured
    foreach ($targetHost in $ExtraHosts) { Add-HostCandidate $targetHost }
    Add-HostCandidate 'localhost'
    Add-HostCandidate '127.0.0.1'
    Add-HostCandidate $env:COMPUTERNAME
    Add-HostCandidate (Get-LocalLanIpv4)

    return ,$hosts
}

function Test-AlwatanApi {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [int]$ApiPort = 4000,
        [int]$TimeoutSec = 2
    )

    try {
        $response = Invoke-WebRequest -Uri "http://${HostName}:${ApiPort}/api/health" -UseBasicParsing -TimeoutSec $TimeoutSec
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Test-AlwatanFrontend {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [int]$FrontendPort = 5173,
        [int]$TimeoutSec = 2
    )

    try {
        $response = Invoke-WebRequest -Uri "http://${HostName}:${FrontendPort}/" -UseBasicParsing -TimeoutSec $TimeoutSec
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Test-AlwatanProductionApp {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [int]$Port = 4000,
        [int]$TimeoutSec = 2
    )

    try {
        $health = Invoke-WebRequest -Uri "http://${HostName}:${Port}/api/health" -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($health.StatusCode -lt 200 -or $health.StatusCode -ge 400) { return $false }
        $home = Invoke-WebRequest -Uri "http://${HostName}:${Port}/" -UseBasicParsing -TimeoutSec $TimeoutSec
        return $home.StatusCode -ge 200 -and $home.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Test-AlwatanServer {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [int]$FrontendPort = 5173,
        [int]$ApiPort = 4000,
        [int]$TimeoutSec = 2
    )

    if (Test-AlwatanFrontend -HostName $HostName -FrontendPort $FrontendPort -TimeoutSec $TimeoutSec) {
        return $true
    }
    return (Test-AlwatanProductionApp -HostName $HostName -Port $ApiPort -TimeoutSec $TimeoutSec)
}

function Get-AlwatanAppUrl {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [int]$FrontendPort = 5173,
        [int]$ApiPort = 4000
    )

    if (Test-AlwatanFrontend -HostName '127.0.0.1' -FrontendPort $FrontendPort) {
        return "http://127.0.0.1:${FrontendPort}/"
    }
    if (Test-AlwatanFrontend -HostName $HostName -FrontendPort $FrontendPort) {
        return "http://${HostName}:${FrontendPort}/"
    }
    if (Test-AlwatanProductionApp -HostName '127.0.0.1' -Port $ApiPort) {
        return "http://127.0.0.1:${ApiPort}/"
    }
    if (Test-AlwatanProductionApp -HostName $HostName -Port $ApiPort) {
        return "http://${HostName}:${ApiPort}/"
    }
    return $null
}

function Find-AlwatanServer {
    param(
        [string[]]$ExtraHosts = @(),
        [int]$FrontendPort = 5173
    )

    foreach ($targetHost in (Get-AlwatanServerCandidates -ExtraHosts $ExtraHosts)) {
        $url = Get-AlwatanAppUrl -HostName $targetHost -FrontendPort $FrontendPort
        if ($url) {
            return @{
                Host = $targetHost
                Url = $url
            }
        }
    }

    return $null
}

function Wait-AlwatanFrontend {
    param(
        [string]$HostName = '127.0.0.1',
        [int]$FrontendPort = 5173,
        [int]$TimeoutSec = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $url = Get-AlwatanAppUrl -HostName $HostName -FrontendPort $FrontendPort
        if ($url) { return $url }
        Start-Sleep -Seconds 2
    }

    return $null
}

function Open-AlwatanBrowser {
    param([Parameter(Mandatory = $true)][string]$Url)
    Start-Process $Url
}

function Stop-PortListeners {
    param([int[]]$Ports)

    foreach ($port in $Ports) {
        Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    }
}

function Ensure-AlwatanLanFirewall {
    param(
        [int[]]$Ports = @(4000, 5173)
    )

    $ok = $true
    foreach ($port in $Ports) {
        $name = "Alwatan Manager LAN TCP $port"
        $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
        if ($existing) {
            $enabled = ($existing | Where-Object { $_.Enabled -eq 'True' })
            if (-not $enabled) {
                try {
                    Enable-NetFirewallRule -DisplayName $name -ErrorAction Stop
                } catch {
                    $ok = $false
                }
            }
            continue
        }

        try {
            New-NetFirewallRule `
                -DisplayName $name `
                -Direction Inbound `
                -Action Allow `
                -Protocol TCP `
                -LocalPort $port `
                -Profile Any `
                -Description "Acces reseau local Clinique Alwatan Manager (TCP $port)" | Out-Null
            Write-Host "Pare-feu ouvert : TCP $port" -ForegroundColor Green
        } catch {
            $ok = $false
        }
    }

    if (-not $ok) {
        Write-Host 'ATTENTION : impossible d''ouvrir le pare-feu (droits admin requis).' -ForegroundColor Yellow
        Write-Host 'Exécutez en Administrateur : scripts\deploy\ouvrir-parefeu.ps1 -IncludeDevPorts' -ForegroundColor Yellow
    }

    return $ok
}

function Ensure-AlwatanEnvFile {
    param([string]$Root)

    $envFile = Join-Path $Root 'backend\.env'
    $example = Join-Path $Root 'backend\.env.example'
    if (-not (Test-Path $envFile) -and (Test-Path $example)) {
        Copy-Item $example $envFile
    }
    return $envFile
}

function Build-AlwatanCorsOrigin {
    param([string]$LanIp)

    $origins = [System.Collections.Generic.List[string]]::new()
    foreach ($origin in @('http://localhost:5173', 'http://127.0.0.1:5173')) {
        if (-not $origins.Contains($origin)) { [void]$origins.Add($origin) }
    }
    if ($LanIp) {
        $lanOrigin = "http://${LanIp}:5173"
        if (-not $origins.Contains($lanOrigin)) { [void]$origins.Add($lanOrigin) }
    }
    return ($origins -join ',')
}

function Ensure-AlwatanIcon {
    param([string]$Root)

    $ico = Join-Path $PSScriptRoot 'alwatan.ico'
    if (Test-Path $ico) {
        return (Resolve-Path $ico).Path
    }

    $jpegCandidates = @(
        (Join-Path $Root 'frontend\public\logo-alwatan.jpeg'),
        (Join-Path $Root 'backend\src\assets\logo-alwatan.jpeg')
    )
    $jpeg = $jpegCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $jpeg) {
        return $null
    }

    try {
        Add-Type -AssemblyName System.Drawing
        $image = [System.Drawing.Image]::FromFile($jpeg)
        $bitmap = New-Object System.Drawing.Bitmap $image
        $handle = $bitmap.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($handle)
        $stream = [System.IO.File]::Create($ico)
        $icon.Save($stream)
        $stream.Close()
        $bitmap.Dispose()
        $image.Dispose()
        return (Resolve-Path $ico).Path
    } catch {
        return $null
    }
}

function New-AlwatanDesktopShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$LauncherPath,
        [string]$Description = '',
        [string]$IconPath = $null
    )

    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop "$Name.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $LauncherPath
    $shortcut.WorkingDirectory = Split-Path $LauncherPath -Parent
    if ($Description) { $shortcut.Description = $Description }
    if ($IconPath -and (Test-Path $IconPath)) {
        $shortcut.IconLocation = "$(Resolve-Path $IconPath),0"
    }
    $shortcut.Save()
    return $shortcutPath
}

function Show-AlwatanMessage {
    param(
        [string]$Title,
        [string]$Message,
        [ValidateSet('Information', 'Warning', 'Error')]
        [string]$Type = 'Information'
    )

    Add-Type -AssemblyName System.Windows.Forms
    $icon = switch ($Type) {
        'Warning' { [System.Windows.Forms.MessageBoxIcon]::Warning }
        'Error' { [System.Windows.Forms.MessageBoxIcon]::Error }
        default { [System.Windows.Forms.MessageBoxIcon]::Information }
    }

    [void][System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
}
