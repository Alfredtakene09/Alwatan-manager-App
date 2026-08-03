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

function Test-AlwatanTailscaleIpv4 {
    param([string]$Ip)
    if (-not $Ip) { return $false }
    # Plage CGNAT Tailscale 100.64.0.0/10
    return [bool]($Ip -match '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.')
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
    param(
        # Inclure l'IP Tailscale en dernier (secours uniquement — pas requis sur le même LAN)
        [switch]$IncludeTailscale
    )

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
            $_.PrefixOrigin -ne 'WellKnown' -and
            $_.InterfaceAlias -notmatch '(?i)tailscale' -and
            -not (Test-AlwatanTailscaleIpv4 $_.IPAddress)
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

    if ($IncludeTailscale) {
        Add-Ip (Get-TailscaleIpv4)
    }
    return ,$ordered.ToArray()
}

function Get-LocalLanIpv4 {
    # IP locale Wi-Fi/Ethernet uniquement — jamais Tailscale (les clients du même réseau
    # se connectent directement avec cette adresse, sans mesh).
    $ips = Get-AlwatanNetworkIps
    foreach ($ip in $ips) {
        if ($ip -eq '192.168.137.1') { continue }
        if (Test-AlwatanTailscaleIpv4 $ip) { continue }
        return $ip
    }
    foreach ($ip in $ips) {
        if ($ip -ne '192.168.137.1') { return $ip }
    }
    return $ips | Select-Object -First 1
}

function Get-AlwatanServerConfigPath {
    Join-Path $PSScriptRoot 'alwatan-server.txt'
}

function Write-AlwatanServerConfig {
    param(
        [Parameter(Mandatory = $true)][string]$ServerIp,
        [string]$TailscaleIp = $null,
        [string]$Path = (Get-AlwatanServerConfigPath)
    )
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    if (-not $TailscaleIp) {
        $TailscaleIp = Get-TailscaleIpv4
    }
    $content = "SERVER_IP=$ServerIp`r`n"
    if ($TailscaleIp -and $TailscaleIp -ne $ServerIp) {
        $content += "TAILSCALE_IP=$TailscaleIp`r`n"
    }
    # Sans BOM : sinon Read-AlwatanServerIp rate la ligne sur certains postes
    [System.IO.File]::WriteAllText($Path, $content, [System.Text.UTF8Encoding]::new($false))
}

function Read-AlwatanConfigValue {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [string]$Path = (Get-AlwatanServerConfigPath)
    )
    if (-not (Test-Path $Path)) { return $null }

    foreach ($line in Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue) {
        $trimmed = ($line -replace '^\uFEFF', '').Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match ("(?i)^" + [regex]::Escape($Key) + "\s*=\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*$")) {
            return $Matches[1]
        }
        if ($trimmed -match ("(?i)^" + [regex]::Escape($Key) + "\s*=\s*(.+)$")) {
            $value = $Matches[1].Trim().Trim('"').Trim("'")
            if ($value -match '^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$') { return $value }
        }
    }
    return $null
}

function Read-AlwatanServerIp {
    $path = Get-AlwatanServerConfigPath
    $fromKey = Read-AlwatanConfigValue -Key 'SERVER_IP' -Path $path
    if ($fromKey) { return $fromKey }

    if (-not (Test-Path $path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $path -ErrorAction SilentlyContinue) {
        $trimmed = ($line -replace '^\uFEFF', '').Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match '^([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*$') {
            return $Matches[1]
        }
    }
    return $null
}

function Read-AlwatanTailscaleIp {
    return Read-AlwatanConfigValue -Key 'TAILSCALE_IP'
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

    # Wi-Fi / Ethernet d'abord, puis Tailscale (même fichier de config)
    Add-HostCandidate (Read-AlwatanServerIp)
    Add-HostCandidate (Read-AlwatanTailscaleIp)
    foreach ($targetHost in $ExtraHosts) { Add-HostCandidate $targetHost }
    Add-HostCandidate 'localhost'
    Add-HostCandidate '127.0.0.1'
    Add-HostCandidate $env:COMPUTERNAME
    Add-HostCandidate (Get-LocalLanIpv4)
    Add-HostCandidate (Get-TailscaleIpv4)

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

    function Get-LatestWriteUtc {
        param([string[]]$Paths)
        $latest = [datetime]::MinValue
        foreach ($path in $Paths) {
            if (-not (Test-Path $path)) { continue }
            $items = Get-ChildItem -Path $path -Recurse -File -ErrorAction SilentlyContinue
            foreach ($item in $items) {
                if ($item.LastWriteTimeUtc -gt $latest) { $latest = $item.LastWriteTimeUtc }
            }
        }
        return $latest
    }

    $beDist = Join-Path $Root 'backend\dist\index.js'
    $feDist = Join-Path $Root 'frontend\dist\index.html'
    $beDistExists = Test-Path $beDist
    $feDistExists = Test-Path $feDist

    $beNeedsBuild = -not $beDistExists
    $feNeedsBuild = -not $feDistExists

    if ($beDistExists) {
        $beSourceLatest = Get-LatestWriteUtc @(
            (Join-Path $Root 'backend\src'),
            (Join-Path $Root 'backend\prisma')
        )
        $beDistTime = (Get-Item $beDist).LastWriteTimeUtc
        $beNeedsBuild = $beSourceLatest -gt $beDistTime
    }

    if ($feDistExists) {
        $feSourceLatest = Get-LatestWriteUtc @(
            (Join-Path $Root 'frontend\src')
        )
        $feDistTime = (Get-Item $feDist).LastWriteTimeUtc
        $feNeedsBuild = $feSourceLatest -gt $feDistTime
    }

    if (-not $beNeedsBuild -and -not $feNeedsBuild) { return $true }

    if (-not $beDistExists -or -not $feDistExists) {
        Write-Host 'Compilation initiale (1 à 3 minutes, une seule fois)...' -ForegroundColor Yellow
    } else {
        Write-Host 'Changements détectés : recompilation production...' -ForegroundColor Yellow
    }

    $be = Join-Path $Root 'backend'
    $fe = Join-Path $Root 'frontend'

    Push-Location $be
    & "$NodeDir\npm.cmd" install 2>$null
    & "$NodeDir\npx.cmd" prisma generate 2>$null
    if ($beNeedsBuild) {
        & "$NodeDir\npm.cmd" run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; return $false }
    }
    Pop-Location

    Push-Location $fe
    & "$NodeDir\npm.cmd" install 2>$null
    if ($feNeedsBuild) {
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

    # Priorité : IP LAN (même réseau) > hotspot Windows > Tailscale (secours)
    $lanPrimary = $ServerIps | Where-Object {
        $_ -and $_ -ne '192.168.137.1' -and -not (Test-AlwatanTailscaleIpv4 $_)
    } | Select-Object -First 1
    $hotspot = $ServerIps | Where-Object { $_ -eq '192.168.137.1' } | Select-Object -First 1
    $tailscale = $ServerIps | Where-Object { Test-AlwatanTailscaleIpv4 $_ } | Select-Object -First 1
    if (-not $tailscale) { $tailscale = Get-TailscaleIpv4 }

    $primary = $lanPrimary
    if (-not $primary) { $primary = $hotspot }
    if (-not $primary) { $primary = $tailscale }
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

    $altLines = @()
    if ($hotspot -and $hotspot -ne $primary) {
        $altLines += "Hotspot Windows (si le Wi-Fi clinique isole les PC) : http://${hotspot}:$Port/"
    }
    if ($tailscale -and $tailscale -ne $primary) {
        $altLines += "Tailscale (optionnel, si le LAN ne passe pas) : http://${tailscale}:$Port/"
    }
    $altBlock = if ($altLines.Count -gt 0) {
        "`r`nAdresses de secours :`r`n" + (($altLines | ForEach-Object { "  $_" }) -join "`r`n") + "`r`n"
    } else { '' }

    $readme = @"
Clinique Alwatan — accès depuis un autre PC
============================================

Même réseau Wi-Fi / Ethernet que le serveur :
  → ouvrez $url
  → Tailscale n'est PAS nécessaire.

Puis double-cliquez sur « Ouvrir Alwatan.bat ».
$altBlock
Si le Wi-Fi clinique bloque les PC entre eux :
  sur le serveur : scripts\activer-hotspot-wifi.cmd
  (ou scripts\activer-acces-mesh.cmd en dernier recours)
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

    $lanIps = @($NetworkIps | Where-Object {
        $_ -and $_ -ne '192.168.137.1' -and -not (Test-AlwatanTailscaleIpv4 $_)
    })
    $hotspot = Get-AlwatanHotspotIpv4
    $tailscale = Get-TailscaleIpv4

    Write-Host '  Accès des autres postes (même réseau — sans Tailscale) :' -ForegroundColor Green
    Write-Host '    1) Copiez le dossier acces-client sur les PC (ou le raccourci Bureau « Ouvrir Alwatan (reseau) »).'
    if ($ClientFolder) {
        Write-Host "       Dossier : $ClientFolder" -ForegroundColor Cyan
    }
    Write-Host '    2) Double-clic sur Ouvrir Alwatan.bat — même adresse IP pour tous les postes du LAN.'
    Write-Host ''
    if ($lanIps.Count -gt 0) {
        Write-Host '       URL réseau local (recommandée) :' -ForegroundColor Green
        foreach ($ip in $lanIps) {
            Write-Host "         http://${ip}:4000" -ForegroundColor Green
        }
    } else {
        foreach ($ip in $NetworkIps) {
            if ($ip) { Write-Host "       http://${ip}:4000" -ForegroundColor Green }
        }
    }
    if ($hotspot) {
        Write-Host "       Hotspot Windows (si Wi-Fi clinique bloque les PC) : http://${hotspot}:4000" -ForegroundColor Yellow
    }
    if ($tailscale) {
        Write-Host "       Tailscale (optionnel / secours) : http://${tailscale}:4000" -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-Host '  Sur le même Wi-Fi/Ethernet : utilisez l''IP locale ci-dessus — Tailscale n''est pas requis.' -ForegroundColor Cyan
    Write-Host '  Wi-Fi bloqué entre postes ? Sur le serveur : scripts\activer-hotspot-wifi.cmd' -ForegroundColor Yellow
    Write-Host '  Dernier recours (mesh) : scripts\activer-acces-mesh.cmd (Tailscale)' -ForegroundColor DarkGray
}

function Open-AlwatanBrowser {
    param([Parameter(Mandatory = $true)][string]$Url)

    $appUrl = $Url.Trim()
    if ($appUrl -notmatch '/$') { $appUrl += '/' }

    # Bust cache navigateur / PWA : ajoute le buildId serveur pour forcer la dernière version
    try {
        $base = $appUrl.TrimEnd('/')
        $ver = Invoke-RestMethod -Uri ("{0}/api/app-version?_={1}" -f $base, [guid]::NewGuid().ToString('N')) -TimeoutSec 3
        if ($ver -and $ver.buildId) {
            $q = [uri]::EscapeDataString([string]$ver.buildId)
            $appUrl = "{0}?v={1}" -f $appUrl, $q
        }
    } catch { }

    $browserCandidates = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    )

    foreach ($browser in $browserCandidates) {
        if (Test-Path $browser) {
            try {
                Start-Process -FilePath $browser -ArgumentList "--app=$appUrl"
                return
            } catch { }
        }
    }

    try {
        Start-Process $appUrl
    } catch {
        # Dernier recours : commande start Windows
        cmd.exe /c start "" "$appUrl" | Out-Null
    }
}

function Write-AlwatanClientLaunchLog {
    param([string]$Message)
    try {
        $dir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message"
        Add-Content -LiteralPath (Join-Path $dir 'last-launch.log') -Value $line -Encoding UTF8
    } catch { }
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

    # IP principale = Wi-Fi/Ethernet + Tailscale enregistrés ensemble
    $tsIp = Get-TailscaleIpv4
    if ($LanIp -and -not (Test-AlwatanTailscaleIpv4 $LanIp) -and $LanIp -ne '192.168.137.1') {
        Write-AlwatanServerConfig -ServerIp $LanIp -TailscaleIp $tsIp
    } elseif ($LanIp) {
        Write-AlwatanServerConfig -ServerIp $LanIp -TailscaleIp $tsIp
    }

    # CORS : LAN + hotspot + Tailscale (secours) pour que les deux modes fonctionnent
    $corsIps = [System.Collections.Generic.List[string]]::new()
    foreach ($ip in $LanIps) {
        if ($ip -and -not $corsIps.Contains($ip)) { [void]$corsIps.Add($ip) }
    }
    $ts = Get-TailscaleIpv4
    if ($ts -and -not $corsIps.Contains($ts)) { [void]$corsIps.Add($ts) }

    $envFile = Join-Path $Root 'backend\.env'
    if (-not (Test-Path $envFile)) { return }

    $corsOrigin = Build-AlwatanCorsOrigin -LanIps $corsIps.ToArray()
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
    $tsIp = Get-TailscaleIpv4

    if (-not $LanIp -and -not $tsIp) {
        Write-Host '  Réseau : IP Wi-Fi / Tailscale introuvable.' -ForegroundColor Yellow
        return
    }

    if ($LanIp) {
        $prodOk = Test-AlwatanProductionApp -HostName $LanIp -Port 4000 -TimeoutSec 5
        Write-Host "  Wi-Fi / Ethernet (IP $LanIp) :" -ForegroundColor Green
        if ($prodOk) {
            Write-Host "    http://${LanIp}:4000" -ForegroundColor Green
        } else {
            Write-Host "    http://${LanIp}:4000 (en attente du démarrage…)" -ForegroundColor Yellow
        }
    }

    if ($tsIp) {
        $tsOk = Test-AlwatanProductionApp -HostName $tsIp -Port 4000 -TimeoutSec 3
        Write-Host "  Tailscale (IP $tsIp) :" -ForegroundColor Cyan
        if ($tsOk) {
            Write-Host "    http://${tsIp}:4000" -ForegroundColor Cyan
        } else {
            Write-Host "    http://${tsIp}:4000 (Tailscale inactif ou en attente…)" -ForegroundColor DarkGray
        }
    }

    $helpIps = @(Get-AlwatanNetworkIps -IncludeTailscale)
    Show-AlwatanCabinetHelp -NetworkIps $helpIps -ClientFolder (Join-Path (Get-AlwatanRoot) 'acces-client')
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
    # -Sta : MessageBox Windows Forms fiable ; log en cas d'échec
    $vbsContent = @"
' Lancement Alwatan Manager (poste client)
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strPs1 = strDir & "\$ScriptBaseName.ps1"
strLog = objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CliniqueAlwatan\last-launch.log"
On Error Resume Next
objFSO.CreateFolder objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CliniqueAlwatan"
On Error GoTo 0
strCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File """ & strPs1 & """"
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
