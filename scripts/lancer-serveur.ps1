# Démarre Alwatan en mode hot reload (par defaut) ou mode cabinet (-Production).
param(
    [switch]$Dev,
    [switch]$Production
)

. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$networkIps = Get-AlwatanNetworkIps
$lanIp = Get-LocalLanIpv4

# Mode cabinet par défaut (démarrage auto + raccourci Bureau « Serveur »).
# Hot reload uniquement via -Dev ou le raccourci « Serveur Auto ».
if (-not $Dev -and -not $Production) {
    $Production = $true
}

Write-Host ''
Write-Host '  Clinique Alwatan — Manager Pro' -ForegroundColor Cyan
if ($Dev -and -not $Production) {
    Write-Host '  Mode développement (ports 4000 + 5173)' -ForegroundColor Cyan
} else {
    Write-Host '  Mode cabinet (port 4000 — recommandé réseau)' -ForegroundColor Cyan
}
Write-Host ''

Ensure-AlwatanEnvFile -Root $Root | Out-Null
Sync-AlwatanLanConfig -Root $Root -LanIp $lanIp -LanIps $networkIps

Ensure-AlwatanPrivateNetwork | Out-Null

$fwPorts = if ($Dev -and -not $Production) { @(4000, 5173) } else { @(4000) }
Write-Host "Ouverture du pare-feu (TCP $($fwPorts -join ', '))..."
$firewallOk = Ensure-AlwatanLanFirewall -Ports $fwPorts
if (-not $firewallOk) {
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $PSScriptRoot 'deploy\forcer-acces-lan.ps1')
        )
        Ensure-AlwatanLanFirewall -Ports $fwPorts | Out-Null
    } catch {
        Write-Host 'Pare-feu : exécutez scripts\forcer-acces-lan.cmd en administrateur.' -ForegroundColor Yellow
    }
}

$dbPort = Get-AlwatanDatabasePort -Root $Root
$dbTest = Test-NetConnection -ComputerName localhost -Port $dbPort -WarningAction SilentlyContinue
if (-not $dbTest.TcpTestSucceeded) {
    Write-Host "ATTENTION : PostgreSQL inaccessible sur localhost:${dbPort}." -ForegroundColor Yellow
}

$prodUrl = $null
if (-not $Dev -and (Test-AlwatanProductionApp -HostName '127.0.0.1' -Port 4000 -TimeoutSec 3)) {
    $prodUrl = 'http://127.0.0.1:4000/'
}
if ($prodUrl -and -not $Dev -and $Production) {
    $clientDir = Publish-AlwatanClientAccess -ServerIps $networkIps -Port 4000 -Root $Root
    Write-Host "Application déjà active : $prodUrl" -ForegroundColor Green
    Show-AlwatanNetworkUrls -LanIp $lanIp
    Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Serveur déjà actif — ouverture de l''application…' -Icon Info
    Open-AlwatanBrowser -Url $prodUrl
    exit 0
}

if ($Dev -and -not $Production) {
    & (Join-Path $PSScriptRoot 'lancer-serveur-dev.ps1')
    exit $LASTEXITCODE
}

# --- Mode cabinet : API + interface sur le port 4000 uniquement ---
$be = Join-Path $Root 'backend'
$corsOrigin = Build-AlwatanCorsOrigin -LanIps $networkIps

if (-not (Ensure-AlwatanProductionBuild -Root $Root -NodeDir $nodeDir)) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message 'La compilation a échoué. Vérifiez Node.js et relancez, ou utilisez lancer-serveur.ps1 -Dev' -Type Error
    exit 1
}

Write-Host 'Arrêt des anciens services sur le port 4000...'
Stop-PortListeners -Ports @(4000)

Write-Host 'Démarrage du serveur cabinet (production locale)...'
Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Démarrage du serveur… L''application s''ouvrira automatiquement dans quelques secondes.' -Icon Info -DurationMs 8000

try {
    $started = Start-AlwatanHiddenNodeServer `
        -NodeDir $nodeDir `
        -BackendDir $be `
        -CorsOrigin $corsOrigin `
        -Title 'Serveur cabinet'
    $serverLog = $started.LogPath
} catch {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message ("Impossible de démarrer le serveur.`n{0}" -f $_.Exception.Message) -Type Error
    exit 1
}

$url = Wait-AlwatanProductionUrl -HostName '127.0.0.1' -Port 4000 -TimeoutSec 90
if (-not $url) {
    $hint = "Journal : $serverLog"
    if (Test-Path (Join-Path (Get-AlwatanLogDir) 'server.err.log')) {
        $hint = "$hint`nErreurs : $(Join-Path (Get-AlwatanLogDir) 'server.err.log')"
    }
    Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Le serveur met trop de temps à démarrer.' -Icon Error
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Le serveur met trop de temps à démarrer.`n$hint" -Type Warning
    exit 1
}

$clientDir = Publish-AlwatanClientAccess -ServerIps $networkIps -Port 4000 -Root $Root
Show-AlwatanTrayTip -Title 'Alwatan Manager' -Message 'Serveur prêt — ouverture de l''application…' -Icon Info -DurationMs 4000
Open-AlwatanBrowser -Url $url

Write-Host ''
Write-Host 'Application prête sur ce poste :' -ForegroundColor Green
Write-Host "  $url"
Show-AlwatanNetworkUrls -LanIp $lanIp
Write-Host ''
