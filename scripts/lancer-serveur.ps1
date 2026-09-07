# Demarre Alwatan en mode hot reload (-Dev) ou mode cabinet (defaut / -Production).
param(
    [switch]$Dev,
    [switch]$Production,
    # Demarrage auto apres reboot : rapide, sans navigateur / rebuild / pare-feu.
    [switch]$Boot
)

. "$PSScriptRoot\_alwatan-common.ps1"
. "$PSScriptRoot\_alwatan-access-ethernet.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath

# Mode cabinet par defaut (demarrage auto + raccourci Bureau Serveur).
if (-not $Dev -and -not $Production) {
    $Production = $true
}
if ($Boot) {
    $Production = $true
    $Dev = $false
}

Write-Host ''
Write-Host '  Clinique Alwatan - Manager Pro' -ForegroundColor Cyan
if ($Dev -and -not $Production) {
    Write-Host '  Mode developpement (ports 4000 + 5173)' -ForegroundColor Cyan
} else {
    Write-Host '  Mode cabinet (port 4000 - recommande reseau)' -ForegroundColor Cyan
}
Write-Host ''

# ---------------------------------------------------------------------------
# CHEMIN RAPIDE : serveur deja actif -> ouvrir immediatement (2-4 s)
# ---------------------------------------------------------------------------
if (-not $Dev -and $Production -and (Test-AlwatanApiReachable -HostName '127.0.0.1' -Port 4000 -TimeoutSec 1)) {
    $beDist = Join-Path $Root 'backend\dist\index.js'
    $feDist = Join-Path $Root 'frontend\dist\index.html'
    $serverNeedsRestart = $false
    if (Test-Path $beDist) {
        $nodeProc = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty OwningProcess
        if ($nodeProc) {
            try {
                $procStart = (Get-Process -Id $nodeProc -ErrorAction Stop).StartTime.ToUniversalTime()
                $beTime = (Get-Item $beDist).LastWriteTimeUtc
                $feTime = if (Test-Path $feDist) { (Get-Item $feDist).LastWriteTimeUtc } else { [datetime]::MinValue }
                if ($beTime -gt $procStart -or $feTime -gt $procStart) { $serverNeedsRestart = $true }
            } catch {
                $serverNeedsRestart = $false
            }
        }
    }
    if (-not $serverNeedsRestart) {
        $networkIps = Get-AlwatanNetworkIps -IncludeTailscale
        $lanIp = Get-LocalLanIpv4
        $accessMode = Read-AlwatanAccessMode -Root $Root
        if ($accessMode -eq 'ethernet_tailscale') {
            $ethIp = Get-AlwatanEthernetIpv4
            $tsOnly = Get-TailscaleIpv4
            if ($ethIp) { $lanIp = $ethIp }
            $networkIps = @($lanIp, $tsOnly | Where-Object { $_ }) | Select-Object -Unique
        }
        Sync-AlwatanLanConfig -Root $Root -LanIp $lanIp -LanIps $networkIps
        if (-not $Boot) {
            Ensure-AlwatanClientAccessPublished -ServerIps $networkIps -Port 4000 -Root $Root | Out-Null
        }
        Ensure-AlwatanServerStayAwake | Out-Null
        Write-Host 'Serveur deja actif - ouverture immediate.' -ForegroundColor Green
        if ($lanIp) { Write-Host "  Ethernet : http://${lanIp}:4000" -ForegroundColor Green }
        Warn-AlwatanEthernetGateway
        if (-not $Boot) {
            Open-AlwatanBrowser -Url 'http://127.0.0.1:4000/' -Fast
        }
        exit 0
    }
    Write-Host 'Nouveau build detecte - redemarrage du serveur...' -ForegroundColor Yellow
}

$dbPort = Get-AlwatanDatabasePort -Root $Root

# Au reboot : attendre PostgreSQL (court) puis IP Ethernet si possible - sans delai fixe long.
if ($Boot) {
    Write-Host 'Demarrage boot rapide (attente PostgreSQL / Ethernet)...' -ForegroundColor Cyan
    $ready = Wait-AlwatanBootPrerequisites -DbPort $dbPort -TimeoutSec 18
    if (-not $ready.DbOk) {
        Write-Host "ATTENTION : PostgreSQL inaccessible sur localhost:${dbPort} - demarrage quand meme." -ForegroundColor Yellow
    }
} elseif (-not (Test-AlwatanQuickTcp -HostName '127.0.0.1' -Port $dbPort -TimeoutMs 500)) {
    Write-Host "ATTENTION : PostgreSQL inaccessible sur localhost:${dbPort}." -ForegroundColor Yellow
}

$networkIps = Get-AlwatanNetworkIps -IncludeTailscale
$lanIp = Get-LocalLanIpv4

Ensure-AlwatanEnvFile -Root $Root | Out-Null

# Si politique Ethernet+Tailscale activee : IP cable + Tailscale seulement (pas Wi-Fi serveur)
$accessMode = Read-AlwatanAccessMode -Root $Root
if ($accessMode -eq 'ethernet_tailscale') {
    $ethIp = Get-AlwatanEthernetIpv4
    $tsOnly = Get-TailscaleIpv4
    if ($ethIp) { $lanIp = $ethIp }
    $networkIps = @($lanIp, $tsOnly | Where-Object { $_ }) | Select-Object -Unique
    Sync-AlwatanLanConfig -Root $Root -LanIp $lanIp -LanIps $networkIps
} else {
    Sync-AlwatanLanConfig -Root $Root -LanIp $lanIp -LanIps $networkIps
}

$fwPorts = if ($Dev -and -not $Production) { @(4000, 5173) } else { @(4000) }
if ($Production) {
    Ensure-AlwatanServerStayAwake | Out-Null
}
if (-not $Boot) {
    Write-Host "Verification pare-feu (TCP $($fwPorts -join ', '))..."
    if ($accessMode -eq 'ethernet_tailscale' -and (Test-AlwatanIsAdmin)) {
        Ensure-AlwatanEthernetTailscaleFirewall -Ports $fwPorts | Out-Null
    } else {
        Ensure-AlwatanLanFirewall -Ports $fwPorts | Out-Null
    }
}

if ($Dev -and -not $Production) {
    & (Join-Path $PSScriptRoot 'lancer-serveur-dev.ps1')
    exit $LASTEXITCODE
}

# --- Mode cabinet : API + interface sur le port 4000 uniquement ---
$be = Join-Path $Root 'backend'
$corsOrigin = Build-AlwatanCorsOrigin -LanIps $networkIps

$beDist = Join-Path $Root 'backend\dist\index.js'
$feDist = Join-Path $Root 'frontend\dist\index.html'
if ($Boot) {
    if (-not (Test-Path $beDist) -or -not (Test-Path $feDist)) {
        Write-AlwatanClientLaunchLog 'Boot: dist manquant - compilation forcee'
        if (-not (Ensure-AlwatanProductionBuild -Root $Root -NodeDir $nodeDir)) {
            Write-AlwatanClientLaunchLog 'Boot: echec compilation'
            exit 1
        }
    } else {
        Write-Host 'Boot : build existant - skip recompilation.' -ForegroundColor DarkGray
    }
} elseif (-not (Ensure-AlwatanProductionBuild -Root $Root -NodeDir $nodeDir)) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message 'La compilation a echoue. Verifiez Node.js et relancez, ou utilisez lancer-serveur.ps1 -Dev' -Type Error
    exit 1
}

Write-Host 'Arret des anciens services sur le port 4000...'
Stop-PortListeners -Ports @(4000)

Write-Host 'Demarrage du serveur cabinet...'
if (-not $Boot) {
    Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Demarrage du serveur... ouverture dans quelques secondes.' -Icon Info -DurationMs 5000
}

try {
    $started = Start-AlwatanHiddenNodeServer `
        -NodeDir $nodeDir `
        -BackendDir $be `
        -CorsOrigin $corsOrigin `
        -Title $(if ($Boot) { 'Serveur cabinet (boot)' } else { 'Serveur cabinet' })
    $serverLog = $started.LogPath
} catch {
    if ($Boot) {
        Write-AlwatanClientLaunchLog ("Boot: echec demarrage - {0}" -f $_.Exception.Message)
        exit 1
    }
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message ("Impossible de demarrer le serveur.`n{0}" -f $_.Exception.Message) -Type Error
    exit 1
}

$waitSec = if ($Boot) { 25 } else { 45 }
$url = Wait-AlwatanProductionUrl -HostName '127.0.0.1' -Port 4000 -TimeoutSec $waitSec
if (-not $url -and (Test-AlwatanApiReachable -HostName '127.0.0.1' -Port 4000 -TimeoutSec 2)) {
    $url = 'http://127.0.0.1:4000/'
}
if (-not $url) {
    $hint = "Journal : $serverLog"
    $errLog = Join-Path (Get-AlwatanLogDir) 'server.err.log'
    if (Test-Path $errLog) { $hint = "$hint`nErreurs : $errLog" }
    if ($Boot) {
        Write-AlwatanClientLaunchLog "Boot: serveur ne repond pas - $hint"
        exit 1
    }
    Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Le serveur ne repond pas encore.' -Icon Error
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Le serveur met trop de temps a demarrer.

1) Verifiez PostgreSQL
2) Relancez Alwatan Manager (Serveur)
3) $hint
"@ -Type Warning
    exit 1
}

if (-not $Boot) {
    Ensure-AlwatanClientAccessPublished -ServerIps $networkIps -Port 4000 -Root $Root | Out-Null
    Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Serveur pret - ouverture...' -Icon Info -DurationMs 2500
    Open-AlwatanBrowser -Url $url -Fast
}

Write-Host ''
Write-Host 'Application prete :' -ForegroundColor Green
Write-Host "  $url"
if ($lanIp) { Write-Host "  Ethernet : http://${lanIp}:4000" -ForegroundColor Green }
$tsIp = Get-TailscaleIpv4
if ($tsIp) { Write-Host "  Tailscale (secours) : http://${tsIp}:4000" -ForegroundColor DarkGray }
Warn-AlwatanEthernetGateway
if ($Boot) {
    Write-Host '  Mode boot : navigateur non ouvert (connexion Ethernet des que le cable est pret).' -ForegroundColor DarkGray
}
Write-Host ''
