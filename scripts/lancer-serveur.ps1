# Demarre Alwatan en mode hot reload (-Dev) ou mode cabinet (defaut / -Production).
param(
    [switch]$Dev,
    [switch]$Production
)

. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath

# Mode cabinet par defaut (demarrage auto + raccourci Bureau « Serveur »).
if (-not $Dev -and -not $Production) {
    $Production = $true
}

Write-Host ''
Write-Host '  Clinique Alwatan — Manager Pro' -ForegroundColor Cyan
if ($Dev -and -not $Production) {
    Write-Host '  Mode developpement (ports 4000 + 5173)' -ForegroundColor Cyan
} else {
    Write-Host '  Mode cabinet (port 4000 — recommande reseau)' -ForegroundColor Cyan
}
Write-Host ''

# ---------------------------------------------------------------------------
# CHEMIN RAPIDE : serveur deja actif → ouvrir immédiatement (2–4 s)
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
        Write-Host 'Serveur deja actif — ouverture immediate.' -ForegroundColor Green
        Open-AlwatanBrowser -Url 'http://127.0.0.1:4000/' -Fast
        exit 0
    }
    Write-Host 'Nouveau build detecte — redemarrage du serveur…' -ForegroundColor Yellow
}

$networkIps = Get-AlwatanNetworkIps -IncludeTailscale
$lanIp = Get-LocalLanIpv4

Ensure-AlwatanEnvFile -Root $Root | Out-Null
Sync-AlwatanLanConfig -Root $Root -LanIp $lanIp -LanIps $networkIps

$fwPorts = if ($Dev -and -not $Production) { @(4000, 5173) } else { @(4000) }
Write-Host "Verification pare-feu (TCP $($fwPorts -join ', '))..."
Ensure-AlwatanLanFirewall -Ports $fwPorts | Out-Null

$dbPort = Get-AlwatanDatabasePort -Root $Root
if (-not (Test-AlwatanQuickTcp -HostName '127.0.0.1' -Port $dbPort -TimeoutMs 500)) {
    Write-Host "ATTENTION : PostgreSQL inaccessible sur localhost:${dbPort}." -ForegroundColor Yellow
}

if ($Dev -and -not $Production) {
    & (Join-Path $PSScriptRoot 'lancer-serveur-dev.ps1')
    exit $LASTEXITCODE
}

# --- Mode cabinet : API + interface sur le port 4000 uniquement ---
$be = Join-Path $Root 'backend'
$corsOrigin = Build-AlwatanCorsOrigin -LanIps $networkIps

if (-not (Ensure-AlwatanProductionBuild -Root $Root -NodeDir $nodeDir)) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message 'La compilation a echoue. Verifiez Node.js et relancez, ou utilisez lancer-serveur.ps1 -Dev' -Type Error
    exit 1
}

Write-Host 'Arret des anciens services sur le port 4000...'
Stop-PortListeners -Ports @(4000)

Write-Host 'Demarrage du serveur cabinet...'
Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Demarrage du serveur… ouverture dans quelques secondes.' -Icon Info -DurationMs 5000

try {
    $started = Start-AlwatanHiddenNodeServer `
        -NodeDir $nodeDir `
        -BackendDir $be `
        -CorsOrigin $corsOrigin `
        -Title 'Serveur cabinet'
    $serverLog = $started.LogPath
} catch {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message ("Impossible de demarrer le serveur.`n{0}" -f $_.Exception.Message) -Type Error
    exit 1
}

$url = Wait-AlwatanProductionUrl -HostName '127.0.0.1' -Port 4000 -TimeoutSec 45
if (-not $url -and (Test-AlwatanApiReachable -HostName '127.0.0.1' -Port 4000 -TimeoutSec 2)) {
    $url = 'http://127.0.0.1:4000/'
}
if (-not $url) {
    $hint = "Journal : $serverLog"
    $errLog = Join-Path (Get-AlwatanLogDir) 'server.err.log'
    if (Test-Path $errLog) { $hint = "$hint`nErreurs : $errLog" }
    Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Le serveur ne repond pas encore.' -Icon Error
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Le serveur met trop de temps a demarrer.

1) Verifiez PostgreSQL
2) Relancez Alwatan Manager (Serveur)
3) $hint
"@ -Type Warning
    exit 1
}

$accesDir = Join-Path $Root 'acces-client'
if (-not (Test-Path (Join-Path $accesDir 'INSTALLER.bat'))) {
    Publish-AlwatanClientAccess -ServerIps $networkIps -Port 4000 -Root $Root | Out-Null
}

Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Serveur pret — ouverture…' -Icon Info -DurationMs 2500
Open-AlwatanBrowser -Url $url -Fast

Write-Host ''
Write-Host 'Application prete :' -ForegroundColor Green
Write-Host "  $url"
if ($lanIp) { Write-Host "  Wi-Fi : http://${lanIp}:4000" -ForegroundColor Green }
$tsIp = Get-TailscaleIpv4
if ($tsIp) { Write-Host "  Tailscale (secours) : http://${tsIp}:4000" -ForegroundColor DarkGray }
Write-Host ''
