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
        # Mode Dev met SERVE_FRONTEND=0 : l'API répond mais sans interface sur :4000
        $frontendHealth = Invoke-WebRequest -Uri "http://${HostName}:${Port}/api/health/frontend" -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($frontendHealth.StatusCode -lt 200 -or $frontendHealth.StatusCode -ge 400) { return $false }
        $payload = $frontendHealth.Content | ConvertFrom-Json
        if (-not $payload.ready) { return $false }
        $homePage = Invoke-WebRequest -Uri "http://${HostName}:${Port}/" -UseBasicParsing -TimeoutSec $TimeoutSec
        return $homePage.StatusCode -ge 200 -and $homePage.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Test-AlwatanApiReachable {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [int]$Port = 4000,
        [int]$TimeoutSec = 2
    )
    try {
        $health = Invoke-WebRequest -Uri "http://${HostName}:${Port}/api/health" -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($health.StatusCode -ge 200 -and $health.StatusCode -lt 400)
    } catch {
        return $false
    }
}

function Test-AlwatanQuickTcp {
    param(
        [string]$HostName = '127.0.0.1',
        [int]$Port = 5432,
        [int]$TimeoutMs = 400
    )
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if (-not $ok) { $client.Close(); return $false }
        $client.EndConnect($iar)
        $client.Close()
        return $true
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
        if (Test-AlwatanApiReachable -HostName $HostName -Port $Port -TimeoutSec 1) {
            return "http://${HostName}:${Port}/"
        }
        Start-Sleep -Milliseconds 400
    }
    return $null
}

function Test-AlwatanServerListening {
    param([int]$Port = 4000)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
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

    # Detecter un dist bundlé CJS (require) incompatible avec ESM
    if ($beDistExists) {
        $probe = Get-Content -LiteralPath $beDist -TotalCount 50 -ErrorAction SilentlyContinue | Out-String
        if ($probe -match 'var import_config = require\(|require\(["'']dotenv') {
            Write-Host 'Build backend invalide (CJS/require) - reconstruction forcee...' -ForegroundColor Yellow
            $beNeedsBuild = $true
        }
    }

    if ($beDistExists -and -not $beNeedsBuild) {
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
    $beNm = Join-Path $be 'node_modules'
    $bePkg = Join-Path $be 'package.json'
    if (-not (Test-Path $beNm) -or ((Get-Item $bePkg).LastWriteTimeUtc -gt (Get-Item $beNm).LastWriteTimeUtc)) {
        & "$NodeDir\npm.cmd" install --prefer-offline --no-audit --no-fund 2>$null
    }
    & "$NodeDir\npx.cmd" prisma generate 2>$null
    if ($beNeedsBuild) {
        # Evite un dist corrompu (bundle CJS incompatible avec "type":"module")
        if (Test-Path $beDist) {
            $probe = Get-Content -LiteralPath $beDist -TotalCount 40 -ErrorAction SilentlyContinue | Out-String
            if ($probe -match 'require\(["'']dotenv') {
                Write-Host 'Build backend corrompu detecte - nettoyage dist...' -ForegroundColor Yellow
                Remove-Item -LiteralPath (Join-Path $Root 'backend\dist') -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        & "$NodeDir\npm.cmd" run build
        if ($LASTEXITCODE -ne 0) {
            if (Test-Path $beDist) {
                Write-Host 'ATTENTION : compilation backend echouee — conservation du build precedent.' -ForegroundColor Yellow
            } else {
                Pop-Location
                return $false
            }
        }
    }
    Pop-Location

    Push-Location $fe
    $feNm = Join-Path $fe 'node_modules'
    $fePkg = Join-Path $fe 'package.json'
    if (-not (Test-Path $feNm) -or ((Get-Item $fePkg).LastWriteTimeUtc -gt (Get-Item $feNm).LastWriteTimeUtc)) {
        & "$NodeDir\npm.cmd" install --prefer-offline --no-audit --no-fund 2>$null
    }
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

function Ensure-AlwatanAppBrowserProfile {
    <#
      Profil Edge/Chrome dédié au mode --app :
      - désactive en-têtes/pieds d'impression
      - force Portrait + ticket 80 mm (évite paysage / A4 sur postes clients)
      Les réglages « sticky » du dialogue d'impression sont réécrits à chaque lancement.
    #>
    $profileRoot = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\app-browser'
    $defaultDir = Join-Path $profileRoot 'Default'
    if (-not (Test-Path -LiteralPath $defaultDir)) {
        New-Item -ItemType Directory -Path $defaultDir -Force | Out-Null
    }

    $prefsPath = Join-Path $defaultDir 'Preferences'
    $prefsObj = $null
    if (Test-Path -LiteralPath $prefsPath) {
        try {
            $prefsObj = Get-Content -LiteralPath $prefsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            $prefsObj = $null
        }
    }
    if (-not $prefsObj) {
        $prefsObj = [pscustomobject]@{}
    }

    $printing = $prefsObj.printing
    if (-not $printing) {
        $printing = [pscustomobject]@{}
        $prefsObj | Add-Member -NotePropertyName printing -NotePropertyValue $printing -Force
    }
    $printing | Add-Member -NotePropertyName print_header_footer -NotePropertyValue $false -Force

    # appState = JSON string (pas un objet) — Chromium le restaure tel quel.
    # 80 mm × 120 mm en microns ; scalingType 0 = DEFAULT (pas « ajuster à la page »).
    $stickyApp = (@'
{"version":2,"isHeaderFooterEnabled":false,"isCssBackgroundEnabled":true,"isLandscapeEnabled":false,"marginsType":1,"scaling":"100","scalingType":0,"scalingTypePdf":0,"mediaSize":{"width_microns":80000,"height_microns":120000,"custom_display_name":"Alwatan Ticket 80mm","is_default":true}}
'@).Trim()

    $sticky = $printing.print_preview_sticky_settings
    if (-not $sticky) {
        $sticky = [pscustomobject]@{ appState = $stickyApp }
        $printing | Add-Member -NotePropertyName print_preview_sticky_settings -NotePropertyValue $sticky -Force
    } else {
        try {
            $sticky | Add-Member -NotePropertyName appState -NotePropertyValue $stickyApp -Force
        } catch {
            $printing | Add-Member -NotePropertyName print_preview_sticky_settings -NotePropertyValue ([pscustomobject]@{ appState = $stickyApp }) -Force
        }
    }

    try {
        $json = $prefsObj | ConvertTo-Json -Depth 40 -Compress:$false
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($prefsPath, $json, $utf8NoBom)
    } catch {
        Write-AlwatanClientLaunchLog "Impossible d'écrire le profil impression : $($_.Exception.Message)"
    }

    return $profileRoot
}

function Get-AlwatanLaunchScreenBounds {
    <#
      Zone utile de l'écran sous le curseur (celui où le raccourci est lancé).
      Retourne $null si indisponible.
    #>
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $screen = $null
        try {
            $screen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
        } catch {
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        }
        if (-not $screen) { $screen = [System.Windows.Forms.Screen]::PrimaryScreen }
        $b = $screen.WorkingArea
        if ($b.Width -gt 0 -and $b.Height -gt 0) {
            return @{ X = [int]$b.X; Y = [int]$b.Y; Width = [int]$b.Width; Height = [int]$b.Height }
        }
    } catch { }
    return $null
}

function Ensure-AlwatanWin32Maximize {
    if ('AlwatanWin32Maximize' -as [type]) { return }
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AlwatanWin32Maximize {
    public const int SW_RESTORE = 9;
    public const int SW_SHOWMAXIMIZED = 3;
    public const int SW_MAXIMIZE = 3;

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static List<IntPtr> FindVisibleWindowsForPid(int processId) {
        var list = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if ((int)pid != processId) return true;
            var cls = new StringBuilder(256);
            GetClassName(hWnd, cls, cls.Capacity);
            // Fenêtres Chromium / Edge (Chrome_WidgetWin_1) — ignorer popups invisibles / tray
            string c = cls.ToString();
            if (c.IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) < 0 &&
                c.IndexOf("Chrome_WidgetWin_1", StringComparison.OrdinalIgnoreCase) < 0) {
                // Accepter aussi toute fenêtre visible suffisamment grande
                RECT r;
                if (!GetWindowRect(hWnd, out r)) return true;
                int w = r.Right - r.Left;
                int h = r.Bottom - r.Top;
                if (w < 200 || h < 200) return true;
            }
            list.Add(hWnd);
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@ -ErrorAction Stop
}

function Set-AlwatanAppWindowPlacementPrefs {
    param(
        [Parameter(Mandatory = $true)][string]$ProfileRoot,
        $Bounds
    )
    if (-not $Bounds) { return }
    $prefsPath = Join-Path $ProfileRoot 'Default\Preferences'
    if (-not (Test-Path -LiteralPath $prefsPath)) { return }
    try {
        $prefsObj = Get-Content -LiteralPath $prefsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $prefsObj) { return }
        $placement = [pscustomobject]@{
            maximized         = $true
            left              = [int]$Bounds.X
            top               = [int]$Bounds.Y
            right             = [int]($Bounds.X + $Bounds.Width)
            bottom            = [int]($Bounds.Y + $Bounds.Height)
            work_area_left    = [int]$Bounds.X
            work_area_top     = [int]$Bounds.Y
            work_area_right   = [int]($Bounds.X + $Bounds.Width)
            work_area_bottom  = [int]($Bounds.Y + $Bounds.Height)
        }
        if (-not $prefsObj.browser) {
            $prefsObj | Add-Member -NotePropertyName browser -NotePropertyValue ([pscustomobject]@{}) -Force
        }
        $prefsObj.browser | Add-Member -NotePropertyName window_placement -NotePropertyValue $placement -Force
        # Mode --app : Chromium stocke aussi parfois ici
        if (-not $prefsObj.app) {
            $prefsObj | Add-Member -NotePropertyName app -NotePropertyValue ([pscustomobject]@{}) -Force
        }
        $prefsObj.app | Add-Member -NotePropertyName window_placement -NotePropertyValue $placement -Force

        $json = $prefsObj | ConvertTo-Json -Depth 40 -Compress:$false
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($prefsPath, $json, $utf8NoBom)
    } catch {
        Write-AlwatanClientLaunchLog "Prefs fenêtre maximisée : $($_.Exception.Message)"
    }
}

function Maximize-AlwatanAppWindow {
    <#
      Edge/Chrome en --app ignore souvent --start-maximized.
      On place la fenêtre sur l'écran cible puis on force Maximize (Win32).
    #>
    param(
        $Bounds,
        [int]$TimeoutMs = 3500
    )
    try {
        Ensure-AlwatanWin32Maximize
    } catch {
        Write-AlwatanClientLaunchLog "Win32 Maximize indisponible : $($_.Exception.Message)"
        return $false
    }

    $deadline = [Environment]::TickCount + $TimeoutMs
    while ([Environment]::TickCount -lt $deadline) {
        $procs = @(
            Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object {
                    ($_.Name -match '^(msedge|chrome)\.exe$') -and
                    $_.CommandLine -and
                    ($_.CommandLine -like '*CliniqueAlwatan\app-browser*' -or $_.CommandLine -like '*CliniqueAlwatan/app-browser*')
                }
        )
        foreach ($p in $procs) {
            try {
                $hwnds = [AlwatanWin32Maximize]::FindVisibleWindowsForPid([int]$p.ProcessId)
            } catch {
                $hwnds = @()
            }
            foreach ($hwnd in $hwnds) {
                if ($hwnd -eq [IntPtr]::Zero) { continue }
                # Restaurer puis placer sur le bon ecran, puis maximiser
                [AlwatanWin32Maximize]::ShowWindow($hwnd, [AlwatanWin32Maximize]::SW_RESTORE) | Out-Null
                if ($Bounds) {
                    [AlwatanWin32Maximize]::MoveWindow(
                        $hwnd,
                        [int]$Bounds.X,
                        [int]$Bounds.Y,
                        [int]$Bounds.Width,
                        [int]$Bounds.Height,
                        $true
                    ) | Out-Null
                }
                [AlwatanWin32Maximize]::ShowWindow($hwnd, [AlwatanWin32Maximize]::SW_SHOWMAXIMIZED) | Out-Null
                [AlwatanWin32Maximize]::SetForegroundWindow($hwnd) | Out-Null
                Write-AlwatanClientLaunchLog "Fenetre maximisee (PID $($p.ProcessId))"
                return $true
            }
        }
        Start-Sleep -Milliseconds 150
    }
    Write-AlwatanClientLaunchLog 'Maximise fenetre : timeout (non bloquant)'
    return $false
}

function Open-AlwatanBrowser {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [switch]$Fast,
        [switch]$ForceHardReload
    )

    $appUrl = $Url.Trim()
    if ($appUrl -notmatch '/$') { $appUrl += '/' }

    try {
        $base = $appUrl.TrimEnd('/')
        $ver = Invoke-RestMethod -Uri ("{0}/api/app-version?_={1}" -f $base, [guid]::NewGuid().ToString('N')) -TimeoutSec 2
        if ($ver -and $ver.buildId) {
            $q = [uri]::EscapeDataString([string]$ver.buildId)
            $appUrl = "{0}?v={1}" -f $appUrl, $q
        }
    } catch { }
    if ($ForceHardReload) {
        $sep = if ($appUrl.Contains('?')) { '&' } else { '?' }
        $appUrl = "{0}{1}hardReloadTs={2}" -f $appUrl, $sep, ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    }

    $profileDir = Ensure-AlwatanAppBrowserProfile
    $bounds = Get-AlwatanLaunchScreenBounds

    if ($Fast) {
        try {
            Ensure-AlwatanWin32Maximize
            $existing = @(
                Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                    Where-Object {
                        ($_.Name -match '^(msedge|chrome)\.exe$') -and
                        $_.CommandLine -and
                        ($_.CommandLine -like '*CliniqueAlwatan*app-browser*')
                    }
            )
            foreach ($p in $existing) {
                $hwnds = [AlwatanWin32Maximize]::FindVisibleWindowsForPid([int]$p.ProcessId)
                foreach ($hwnd in $hwnds) {
                    if ($hwnd -eq [IntPtr]::Zero) { continue }
                    [AlwatanWin32Maximize]::ShowWindow($hwnd, [AlwatanWin32Maximize]::SW_SHOWMAXIMIZED) | Out-Null
                    [AlwatanWin32Maximize]::SetForegroundWindow($hwnd) | Out-Null
                    Write-AlwatanClientLaunchLog "Fenetre appli deja ouverte - focus (PID $($p.ProcessId))"
                    return
                }
            }
        } catch { }
    }

    if (-not $Fast) {
        try {
            Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object {
                    ($_.Name -match '^(msedge|chrome)\.exe$') -and
                    $_.CommandLine -and
                    ($_.CommandLine -like '*CliniqueAlwatan*app-browser*')
                } |
                ForEach-Object {
                    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                }
            Start-Sleep -Milliseconds 300
        } catch { }
        Set-AlwatanAppWindowPlacementPrefs -ProfileRoot $profileDir -Bounds $bounds
    }
    if ($ForceHardReload) {
        try {
            $cacheTargets = @(
                (Join-Path $profileDir 'Default\Cache'),
                (Join-Path $profileDir 'Default\Code Cache'),
                (Join-Path $profileDir 'Default\Service Worker\CacheStorage'),
                (Join-Path $profileDir 'Default\Service Worker\Database')
            )
            foreach ($target in $cacheTargets) {
                if (Test-Path -LiteralPath $target) {
                    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
                }
            }
            Write-AlwatanClientLaunchLog 'Rechargement agressif : caches navigateur purges'
        } catch {
            Write-AlwatanClientLaunchLog "Rechargement agressif : purge cache impossible ($($_.Exception.Message))"
        }
    }

    $browserArgs = @(
        "--user-data-dir=$profileDir",
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized'
    )
    if ($bounds) {
        $browserArgs += @(
            "--window-position=$($bounds.X),$($bounds.Y)",
            "--window-size=$($bounds.Width),$($bounds.Height)"
        )
    }
    $browserArgs += "--app=$appUrl"

    $browserCandidates = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )

    $maxWait = if ($Fast) { 0 } else { 4000 }

    foreach ($browser in $browserCandidates) {
        if (Test-Path $browser) {
            try {
                Start-Process -FilePath $browser -ArgumentList $browserArgs
                Write-AlwatanClientLaunchLog "Navigateur appli : $browser"
                if ($maxWait -gt 0) {
                    $null = Maximize-AlwatanAppWindow -Bounds $bounds -TimeoutMs $maxWait
                }
                return
            } catch { }
        }
    }

    try {
        Start-Process $appUrl
    } catch {
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
        $LanIps = @(Get-AlwatanNetworkIps -IncludeTailscale)
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
    $seenServe = $false

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
        if ($line -match '^\s*SERVE_FRONTEND\s*=') {
            [void]$out.Add('SERVE_FRONTEND=1')
            $seenServe = $true
            continue
        }
        [void]$out.Add($line)
    }

    if (-not $seenHost) { [void]$out.Add('HOST=0.0.0.0') }
    if (-not $seenCors) { [void]$out.Add("CORS_ORIGIN=`"$corsOrigin`"") }
    if (-not $seenServe) { [void]$out.Add('SERVE_FRONTEND=1') }

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

function Get-AlwatanLogDir {
    $dir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan'
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    return $dir
}

function Get-AlwatanServerLogPath {
    return (Join-Path (Get-AlwatanLogDir) 'server.log')
}

function Show-AlwatanTrayTip {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('Info', 'Warning', 'Error')]
        [string]$Icon = 'Info',
        [int]$DurationMs = 6000
    )
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $notify = New-Object System.Windows.Forms.NotifyIcon
        $notify.Icon = [System.Drawing.SystemIcons]::Information
        if ($Icon -eq 'Warning') { $notify.Icon = [System.Drawing.SystemIcons]::Warning }
        if ($Icon -eq 'Error') { $notify.Icon = [System.Drawing.SystemIcons]::Error }
        $notify.Visible = $true
        $tipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        if ($Icon -eq 'Warning') { $tipIcon = [System.Windows.Forms.ToolTipIcon]::Warning }
        if ($Icon -eq 'Error') { $tipIcon = [System.Windows.Forms.ToolTipIcon]::Error }
        $notify.BalloonTipIcon = $tipIcon
        $notify.BalloonTipTitle = $Title
        $notify.BalloonTipText = $Message
        $notify.ShowBalloonTip($DurationMs)
        Start-Sleep -Milliseconds 400
        # Laisse le toast visible ; destruction différée
        Start-Job -ScriptBlock {
            param($ms)
            Start-Sleep -Milliseconds ($ms + 1500)
        } -ArgumentList $DurationMs | Out-Null
        # Ne pas disposer immédiatement sinon le toast disparaît
        $script:AlwatanTrayTips = @($script:AlwatanTrayTips) + @($notify)
    } catch {
        Write-AlwatanClientLaunchLog ("TrayTip impossible : {0}" -f $_.Exception.Message)
    }
}

function Start-AlwatanHiddenNodeServer {
    <#
      Démarre node dist/index.js sans fenêtre (pas de npm.cmd = fiable en mode Hidden).
      Sortie redirigée vers server.log / server.err.log.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$NodeDir,
        [Parameter(Mandatory = $true)][string]$BackendDir,
        [Parameter(Mandatory = $true)][string]$CorsOrigin,
        [string]$LogPath = (Get-AlwatanServerLogPath),
        [string]$HostBind = '0.0.0.0',
        [string]$ServeFrontend = '1',
        [string]$Title = 'Serveur cabinet'
    )

    $nodeExe = Join-Path $NodeDir 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) {
        throw "node.exe introuvable : $nodeExe"
    }
    $entry = Join-Path $BackendDir 'dist\index.js'
    if (-not (Test-Path -LiteralPath $entry)) {
        throw "Build manquant : $entry"
    }

    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $errPath = Join-Path $logDir 'server.err.log'
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    # Start-Process -RedirectStandardOutput ecrase le fichier : entete uniquement dans last-launch.log
    Write-AlwatanClientLaunchLog ("Demarrage {0} a {1}" -f $Title, $stamp)

    # Hérite de l'environnement du processus courant (Start-Process + Redirect = UseShellExecute false)
    $prev = @{
        Path           = $env:Path
        HOST           = $env:HOST
        SERVE_FRONTEND = $env:SERVE_FRONTEND
        CORS_ORIGIN    = $env:CORS_ORIGIN
    }
    $env:Path = "$NodeDir;" + $env:Path
    $env:HOST = $HostBind
    $env:SERVE_FRONTEND = $ServeFrontend
    $env:CORS_ORIGIN = $CorsOrigin

    try {
        $proc = Start-Process -FilePath $nodeExe `
            -ArgumentList @('dist\index.js') `
            -WorkingDirectory $BackendDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $LogPath `
            -RedirectStandardError $errPath `
            -PassThru
    } finally {
        $env:Path = $prev.Path
        if ($null -eq $prev.HOST) { Remove-Item Env:HOST -ErrorAction SilentlyContinue } else { $env:HOST = $prev.HOST }
        if ($null -eq $prev.SERVE_FRONTEND) { Remove-Item Env:SERVE_FRONTEND -ErrorAction SilentlyContinue } else { $env:SERVE_FRONTEND = $prev.SERVE_FRONTEND }
        if ($null -eq $prev.CORS_ORIGIN) { Remove-Item Env:CORS_ORIGIN -ErrorAction SilentlyContinue } else { $env:CORS_ORIGIN = $prev.CORS_ORIGIN }
    }

    if (-not $proc) {
        throw 'Impossible de démarrer le processus node.'
    }

    Write-AlwatanClientLaunchLog ("Node masque demarre PID={0} ({1}) - log : {2}" -f $proc.Id, $Title, $LogPath)
    return @{
        LogPath   = $LogPath
        ErrPath   = $errPath
        ProcessId = $proc.Id
    }
}

function Start-AlwatanHiddenPowerShell {
    <#
      Lance une commande via cmd.exe /c sans fenêtre (npm/vite).
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string]$WorkingDirectory = '',
        [string]$LogPath = (Get-AlwatanServerLogPath),
        [string]$Title = 'Alwatan'
    )

    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    try {
        Add-Content -LiteralPath $LogPath -Value ("`r`n==== {0}  {1} ====`r`n" -f $stamp, $Title) -Encoding UTF8
    } catch { }

    $tmpCmd = Join-Path $logDir ('run-hidden-{0}.cmd' -f [guid]::NewGuid().ToString('N'))
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add('@echo off')
    if ($WorkingDirectory) {
        [void]$lines.Add(('cd /d "{0}"' -f $WorkingDirectory))
    }
    [void]$lines.Add(('echo ==== %DATE% %TIME% %s ====>> "{0}"' -f $LogPath))
    [void]$lines.Add(('{0} >> "{1}" 2>&1' -f $Command, $LogPath))
    Set-Content -LiteralPath $tmpCmd -Value ($lines -join "`r`n") -Encoding ASCII

    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$tmpCmd`"") -WindowStyle Hidden | Out-Null
    Write-AlwatanClientLaunchLog ("CMD masque demarre ({0}) - log : {1}" -f $Title, $LogPath)
    return $LogPath
}

function Update-AlwatanSilentLauncher {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptBaseName,
        [string]$ScriptsDir = $PSScriptRoot,
        [string]$ExtraArgs = ''
    )

    $ps1Path = Join-Path $ScriptsDir "$ScriptBaseName.ps1"
    if (-not (Test-Path $ps1Path)) {
        throw "Script introuvable : $ps1Path"
    }

    $vbsPath = Join-Path $ScriptsDir "$ScriptBaseName-silencieux.vbs"
    $argsPart = if ($ExtraArgs) { " $ExtraArgs" } else { '' }
    # -Sta : MessageBox Windows Forms fiable ; log en cas d'échec
    $vbsContent = @"
' Lancement Alwatan Manager
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strPs1 = strDir & "\$ScriptBaseName.ps1"
strLog = objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CliniqueAlwatan\last-launch.log"
On Error Resume Next
objFSO.CreateFolder objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CliniqueAlwatan"
On Error GoTo 0
strCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File """ & strPs1 & """$argsPart"
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
