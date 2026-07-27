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

function Get-AlwatanHotspotIpv4 {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -eq '192.168.137.1' } |
        Select-Object -First 1
    if ($addr) { return $addr.IPAddress }
    return $null
}

function Get-TailscaleIpv4 {
    $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    try {
        $ip = & tailscale ip -4 2>$null | Select-Object -First 1
        $trimmed = "$ip".Trim()
        if ($trimmed -match '^\d{1,3}(\.\d{1,3}){3}$') { return $trimmed }
    } catch { }
    return $null
}

function Get-AlwatanNetworkIps {
    $ordered = [System.Collections.Generic.List[string]]::new()
    $seen = @{}

    function Add-Ip([string]$Value) {
        if (-not $Value -or $seen.ContainsKey($Value)) { return }
        $seen[$Value] = $true
        [void]$ordered.Add($Value)
    }

    $addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.PrefixOrigin -ne 'WellKnown'
        }

    foreach ($row in ($addrs | Where-Object { $_.InterfaceAlias -match 'Ethernet' } | Sort-Object InterfaceMetric)) {
        Add-Ip $row.IPAddress
    }
    foreach ($row in ($addrs | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|WLAN' } | Sort-Object InterfaceMetric)) {
        if ($row.IPAddress -notlike '192.168.137.*') { Add-Ip $row.IPAddress }
    }
    foreach ($row in ($addrs | Sort-Object InterfaceMetric)) {
        Add-Ip $row.IPAddress
    }

    Add-Ip (Get-TailscaleIpv4)
    return ,$ordered.ToArray()
}

function Get-LocalLanIpv4 {
    $ips = Get-AlwatanNetworkIps
    foreach ($ip in $ips) {
        if ($ip -ne '192.168.137.1') { return $ip }
    }
    return $ips | Select-Object -First 1
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
        $homePage = Invoke-WebRequest -Uri "http://${HostName}:${Port}/" -UseBasicParsing -TimeoutSec $TimeoutSec
        return $homePage.StatusCode -ge 200 -and $homePage.StatusCode -lt 400
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

    $normalized = $HostName.Trim().ToLower()
    $isLocal = $normalized -in @('127.0.0.1', 'localhost')

    if (-not $isLocal) {
        if (Test-AlwatanFrontend -HostName $HostName -FrontendPort $FrontendPort) {
            return "http://${HostName}:${FrontendPort}/"
        }
        if (Test-AlwatanProductionApp -HostName $HostName -Port $ApiPort) {
            return "http://${HostName}:${ApiPort}/"
        }
        return $null
    }

    if (Test-AlwatanFrontend -HostName '127.0.0.1' -FrontendPort $FrontendPort) {
        return "http://127.0.0.1:${FrontendPort}/"
    }
    if (Test-AlwatanProductionApp -HostName '127.0.0.1' -Port $ApiPort) {
        return "http://127.0.0.1:${ApiPort}/"
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

function Wait-AlwatanProductionUrl {
    param(
        [string]$HostName = '127.0.0.1',
        [int]$Port = 4000,
        [int]$TimeoutSec = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-AlwatanProductionApp -HostName $HostName -Port $Port -TimeoutSec 3) {
            return "http://${HostName}:${Port}/"
        }
        Start-Sleep -Seconds 2
    }
    return $null
}

function Ensure-AlwatanProductionBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$NodeDir
    )

    $beDist = Join-Path $Root 'backend\dist\index.js'
    $feDist = Join-Path $Root 'frontend\dist\index.html'
    if ((Test-Path $beDist) -and (Test-Path $feDist)) { return $true }

    Write-Host 'Compilation initiale (1 à 3 minutes, une seule fois)...' -ForegroundColor Yellow

    $be = Join-Path $Root 'backend'
    $fe = Join-Path $Root 'frontend'

    Push-Location $be
    & "$NodeDir\npm.cmd" install 2>$null
    & "$NodeDir\npx.cmd" prisma generate 2>$null
    if (-not (Test-Path $beDist)) {
        & "$NodeDir\npm.cmd" run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; return $false }
    }
    Pop-Location

    Push-Location $fe
    & "$NodeDir\npm.cmd" install 2>$null
    if (-not (Test-Path $feDist)) {
        & "$NodeDir\npm.cmd" run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; return $false }
    }
    Pop-Location

    return (Test-Path $beDist) -and (Test-Path $feDist)
}

function Publish-AlwatanClientAccess {
    param(
        [Parameter(Mandatory = $true)][string[]]$ServerIps,
        [int]$Port = 4000,
        [string]$Root = (Get-AlwatanRoot)
    )

    $hotspot = $ServerIps | Where-Object { $_ -eq '192.168.137.1' } | Select-Object -First 1
    $primary = if ($hotspot) { $hotspot } else {
        $ServerIps | Where-Object { $_ -and $_ -ne '192.168.137.1' } | Select-Object -First 1
    }
    if (-not $primary) { $primary = ($ServerIps | Select-Object -First 1) }
    if (-not $primary) { return $null }

    $creer = Join-Path $PSScriptRoot 'creer-setup-client.ps1'
    if (Test-Path $creer) {
        & $creer -ServerIp $primary -Port $Port -Quiet
        return Join-Path $Root 'acces-client'
    }

    $url = "http://${primary}:$Port/"
    $outDir = Join-Path $Root 'acces-client'
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null

    $bat = @"
@echo off
title Alwatan Manager
start "" "$url"
"@
    Set-Content -LiteralPath (Join-Path $outDir 'Ouvrir Alwatan.bat') -Value $bat -Encoding ASCII

    $shortcut = @"
[InternetShortcut]
URL=$url
"@
    Set-Content -LiteralPath (Join-Path $outDir 'Ouvrir Alwatan.url') -Value $shortcut -Encoding ASCII

    $readme = @"
Clinique Alwatan — accès depuis un autre PC
============================================

IMPORTANT : le Wi-Fi de la clinique bloque souvent les PC entre eux.
Connectez chaque poste au Wi-Fi du SERVEUR (partage de connexion Windows),
PAS au Wi-Fi de la box.

Puis double-cliquez sur « Ouvrir Alwatan.bat ».

Adresse (après connexion au Wi-Fi du serveur) : $url

Si besoin, sur le serveur : scripts\lancer-postes-clients.cmd
"@
    Set-Content -LiteralPath (Join-Path $outDir 'LISEZMOI.txt') -Value $readme -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $outDir 'LIEN-SERVEUR.txt') -Value $url.TrimEnd('/') -Encoding ASCII

    $desktop = [Environment]::GetFolderPath('Desktop')
    Copy-Item -LiteralPath (Join-Path $outDir 'Ouvrir Alwatan.bat') -Destination (Join-Path $desktop 'Ouvrir Alwatan (reseau).bat') -Force
    Copy-Item -LiteralPath (Join-Path $outDir 'Ouvrir Alwatan.url') -Destination (Join-Path $desktop 'Ouvrir Alwatan (reseau).url') -Force

    return $outDir
}

function Show-AlwatanCabinetHelp {
    param(
        [string[]]$NetworkIps,
        [string]$ClientFolder
    )

    $hotspot = Get-AlwatanHotspotIpv4
    $tailscale = Get-TailscaleIpv4

    Write-Host '  Accès des autres postes (mode fiable) :' -ForegroundColor Green
    Write-Host '    1) Copiez le dossier acces-client sur les PC (ou le raccourci Bureau « Ouvrir Alwatan (reseau) »).'
    if ($ClientFolder) {
        Write-Host "       Dossier : $ClientFolder" -ForegroundColor Cyan
    }
    Write-Host '    2) Double-clic sur Ouvrir Alwatan.bat — pas de script PowerShell.'
    Write-Host ''
    foreach ($ip in $NetworkIps) {
        if ($ip) { Write-Host "       http://${ip}:4000" -ForegroundColor Green }
    }
    if ($hotspot) {
        Write-Host "       Hotspot Windows (si Wi-Fi clinique bloque les PC) : http://${hotspot}:4000" -ForegroundColor Yellow
    }
    if ($tailscale) {
        Write-Host "       Tailscale (réseau mesh) : http://${tailscale}:4000" -ForegroundColor Cyan
    }
    Write-Host ''
    Write-Host '  Wi-Fi bloqué entre postes ? Sur le serveur : scripts\activer-hotspot-wifi.cmd' -ForegroundColor Yellow
    Write-Host '  Solution la plus fiable : scripts\activer-acces-mesh.cmd (Tailscale, gratuit)' -ForegroundColor Yellow
}

function Open-AlwatanBrowser {
    param([Parameter(Mandatory = $true)][string]$Url)

    $appUrl = $Url.Trim()
    if ($appUrl -notmatch '/$') { $appUrl += '/' }

    $browserCandidates = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    )

    foreach ($browser in $browserCandidates) {
        if (Test-Path $browser) {
            Start-Process -FilePath $browser -ArgumentList "--app=$appUrl"
            return
        }
    }

    Start-Process $appUrl
}

function Stop-PortListeners {
    param([int[]]$Ports)

    foreach ($port in $Ports) {
        Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    }
}

function Get-AlwatanDatabasePort {
    param([string]$Root = (Get-AlwatanRoot))

    $envFile = Join-Path $Root 'backend\.env'
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile -ErrorAction SilentlyContinue) {
            if ($line -match 'DATABASE_URL\s*=\s*"[^"]*@[^:]+:(\d+)/') {
                return [int]$Matches[1]
            }
            if ($line -match 'DATABASE_URL\s*=\s*[^"]*@[^:]+:(\d+)/') {
                return [int]$Matches[1]
            }
        }
    }
    return 5433
}

function Ensure-AlwatanPrivateNetwork {
    $profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4Connectivity -eq 'Internet' -or $_.IPv4Connectivity -eq 'LocalNetwork' }
    foreach ($profile in $profiles) {
        if ($profile.NetworkCategory -eq 'Public') {
            try {
                Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
                Write-Host "Réseau « $($profile.InterfaceAlias) » passé en Privé (recommandé pour le LAN)." -ForegroundColor Green
            } catch {
                Write-Host "Impossible de passer « $($profile.InterfaceAlias) » en réseau Privé (admin requis)." -ForegroundColor Yellow
            }
        }
    }
}

function Test-AlwatanIsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-AlwatanNodeFirewall {
    $nodePath = Join-Path ${env:ProgramFiles} 'nodejs\node.exe'
    if (-not (Test-Path $nodePath)) { return }

    foreach ($profile in @('private', 'domain')) {
        $ruleName = "Alwatan Node.js inbound ($profile)"
        $existing = netsh advfirewall firewall show rule name="$ruleName" 2>$null
        if ($LASTEXITCODE -eq 0) { continue }

        netsh advfirewall firewall add rule `
            name="$ruleName" `
            dir=in action=allow protocol=TCP `
            program="$nodePath" `
            profile=$profile enable=yes | Out-Null
    }
}

function Ensure-AlwatanLanFirewallNetsh {
    param([int[]]$Ports = @(4000, 5173))

    foreach ($port in $Ports) {
        $ruleName = "Alwatan Manager LAN TCP $port (netsh)"
        netsh advfirewall firewall show rule name="$ruleName" 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            netsh advfirewall firewall add rule `
                name="$ruleName" `
                dir=in action=allow protocol=TCP `
                localport=$port profile=any enable=yes | Out-Null
        }
    }
    Ensure-AlwatanNodeFirewall
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
        Write-Host 'Exécutez en Administrateur : scripts\forcer-acces-lan.cmd' -ForegroundColor Yellow
    } elseif (Test-AlwatanIsAdmin) {
        Ensure-AlwatanLanFirewallNetsh -Ports $Ports | Out-Null
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
    param([string[]]$LanIps = @())

    $origins = [System.Collections.Generic.List[string]]::new()
    foreach ($origin in @(
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4000',
        'http://127.0.0.1:4000'
    )) {
        if (-not $origins.Contains($origin)) { [void]$origins.Add($origin) }
    }
    foreach ($ip in $LanIps) {
        if (-not $ip) { continue }
        foreach ($port in @(5173, 4000)) {
            $lanOrigin = "http://${ip}:$port"
            if (-not $origins.Contains($lanOrigin)) { [void]$origins.Add($lanOrigin) }
        }
    }
    return ($origins -join ',')
}

function Sync-AlwatanLanConfig {
    param(
        [string]$Root,
        [string]$LanIp,
        [string[]]$LanIps = @()
    )

    if (-not $LanIps -or $LanIps.Count -eq 0) {
        $LanIps = @(Get-AlwatanNetworkIps)
    }
    if (-not $LanIp) {
        $LanIp = Get-LocalLanIpv4
    }

    if ($LanIp) {
        $serverTxt = Join-Path $PSScriptRoot 'alwatan-server.txt'
        Set-Content -Path $serverTxt -Value "SERVER_IP=$LanIp" -Encoding UTF8
    }

    $envFile = Join-Path $Root 'backend\.env'
    if (-not (Test-Path $envFile)) { return }

    $corsOrigin = Build-AlwatanCorsOrigin -LanIps $LanIps
    $lines = Get-Content $envFile -ErrorAction SilentlyContinue
    $out = [System.Collections.Generic.List[string]]::new()
    $seenHost = $false
    $seenCors = $false

    foreach ($line in $lines) {
        if ($line -match '^\s*HOST\s*=') {
            [void]$out.Add('HOST=0.0.0.0')
            $seenHost = $true
            continue
        }
        if ($line -match '^\s*CORS_ORIGIN\s*=') {
            [void]$out.Add("CORS_ORIGIN=`"$corsOrigin`"")
            $seenCors = $true
            continue
        }
        [void]$out.Add($line)
    }

    if (-not $seenHost) { [void]$out.Add('HOST=0.0.0.0') }
    if (-not $seenCors) { [void]$out.Add("CORS_ORIGIN=`"$corsOrigin`"") }

    Set-Content -Path $envFile -Value $out -Encoding UTF8
}

function Show-AlwatanNetworkUrls {
    param([string]$LanIp)

    if (-not $LanIp) {
        $LanIp = Get-LocalLanIpv4
    }
    if (-not $LanIp) {
        Write-Host '  Réseau : IP LAN introuvable — vérifiez la connexion Wi-Fi/Ethernet.' -ForegroundColor Yellow
        return
    }

    $prodOk = Test-AlwatanProductionApp -HostName $LanIp -Port 4000 -TimeoutSec 5

    Write-Host "  Sur le réseau (IP $LanIp) :" -ForegroundColor Green
    if ($prodOk) {
        Write-Host "    URL unique      : http://${LanIp}:4000" -ForegroundColor Green
    } else {
        Write-Host "    http://${LanIp}:4000 (en attente du démarrage…)" -ForegroundColor Yellow
    }
    Show-AlwatanCabinetHelp -NetworkIps (Get-AlwatanNetworkIps) -ClientFolder (Join-Path (Get-AlwatanRoot) 'acces-client')
}

function Save-AlwatanIconFromImage {
    param(
        [Parameter(Mandatory = $true)][string]$SourceImage,
        [Parameter(Mandatory = $true)][string]$DestIco
    )

    Add-Type -AssemblyName System.Drawing
    if (-not ('Win32.NativeMethods' -as [type])) {
        Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Auto)]
public static extern bool DestroyIcon(IntPtr handle);
'@
    }

    $img = [System.Drawing.Image]::FromFile($SourceImage)
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.Clear([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
        $margin = [int]($size * 0.08)
        $inner = $size - (2 * $margin)
        $g.DrawImage($img, $margin, $margin, $inner, $inner)
        $g.Dispose()

        $hIcon = $bmp.GetHicon()
        try {
            $icon = [System.Drawing.Icon]::FromHandle($hIcon)
            $stored = New-Object System.Drawing.Icon($icon, $size, $size)
            $parent = Split-Path $DestIco -Parent
            if ($parent -and -not (Test-Path $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            }
            $fs = [System.IO.File]::Create($DestIco)
            try {
                $stored.Save($fs)
            } finally {
                $fs.Close()
            }
            $stored.Dispose()
            $icon.Dispose()
            return (Resolve-Path $DestIco).Path
        } finally {
            [void][Win32.NativeMethods]::DestroyIcon($hIcon)
        }
    } finally {
        $bmp.Dispose()
        $img.Dispose()
    }
}

function Get-AlwatanIconStorePath {
    Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\alwatan.ico'
}

function Ensure-AlwatanIcon {
    param(
        [string]$Root,
        [switch]$Force
    )

    if (-not $Root) { $Root = Get-AlwatanRoot }

    $jpegCandidates = @(
        (Join-Path $Root 'frontend\public\logo-alwatan.jpeg'),
        (Join-Path $Root 'backend\src\assets\logo-alwatan.jpeg'),
        (Join-Path $Root 'frontend\public\pwa\icon-256.png'),
        (Join-Path $Root 'frontend\public\pwa\icon-512.png')
    )
    $source = $jpegCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    $scriptIco = Join-Path $PSScriptRoot 'alwatan.ico'
    $stableIco = Get-AlwatanIconStorePath

    if (-not $source) {
        if (Test-Path $stableIco) { return (Resolve-Path $stableIco).Path }
        if (Test-Path $scriptIco) { return (Resolve-Path $scriptIco).Path }
        return $null
    }

    $sourceTime = (Get-Item $source).LastWriteTimeUtc
    $needsBuild = $Force.IsPresent
    foreach ($dest in @($scriptIco, $stableIco)) {
        if (-not (Test-Path $dest)) { $needsBuild = $true; break }
        if ((Get-Item $dest).LastWriteTimeUtc -lt $sourceTime) { $needsBuild = $true; break }
    }

    if ($needsBuild) {
        $built = Save-AlwatanIconFromImage -SourceImage $source -DestIco $scriptIco
        if (-not $built) { return $null }
        $stableDir = Split-Path $stableIco -Parent
        if (-not (Test-Path $stableDir)) {
            New-Item -ItemType Directory -Path $stableDir -Force | Out-Null
        }
        Copy-Item $scriptIco $stableIco -Force
    }

    if (Test-Path $stableIco) { return (Resolve-Path $stableIco).Path }
    if (Test-Path $scriptIco) { return (Resolve-Path $scriptIco).Path }
    return $null
}

function Update-AlwatanSilentLauncher {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptBaseName,
        [string]$ScriptsDir = $PSScriptRoot
    )

    $ps1Path = Join-Path $ScriptsDir "$ScriptBaseName.ps1"
    if (-not (Test-Path $ps1Path)) {
        throw "Script introuvable : $ps1Path"
    }

    $vbsPath = Join-Path $ScriptsDir "$ScriptBaseName-silencieux.vbs"
    $vbsContent = @"
' Lancement sans fenêtre console — Clinique Alwatan Manager
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strPs1 = strDir & "\$ScriptBaseName.ps1"
strCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & strPs1 & """"
objShell.Run strCmd, 0, False
"@
    Set-Content -LiteralPath $vbsPath -Value $vbsContent -Encoding ASCII
    return (Resolve-Path $vbsPath).Path
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
    $launcherResolved = (Resolve-Path $LauncherPath).Path
    $launcherDir = Split-Path $launcherResolved -Parent

    if ($launcherResolved -like '*.vbs') {
        $shortcut.TargetPath = $launcherResolved
        $shortcut.Arguments = ''
        $shortcut.WorkingDirectory = $launcherDir
    } else {
        $shortcut.TargetPath = $launcherResolved
        $shortcut.WorkingDirectory = $launcherDir
    }

    if ($Description) { $shortcut.Description = $Description }
    if ($IconPath -and (Test-Path $IconPath)) {
        $iconFile = (Resolve-Path $IconPath).Path
        $shortcut.IconLocation = "$iconFile,0"
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
