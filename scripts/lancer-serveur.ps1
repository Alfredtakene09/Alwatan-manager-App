# Démarre Alwatan en mode cabinet (1 port, accès réseau fiable) ou mode dev (-Dev).
param(
    [switch]$Dev
)

. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$networkIps = Get-AlwatanNetworkIps
$lanIp = Get-LocalLanIpv4

Write-Host ''
Write-Host '  Clinique Alwatan — Manager Pro' -ForegroundColor Cyan
if ($Dev) {
    Write-Host '  Mode développement (ports 4000 + 5173)' -ForegroundColor Cyan
} else {
    Write-Host '  Mode cabinet (port 4000 — recommandé réseau)' -ForegroundColor Cyan
}
Write-Host ''

Ensure-AlwatanEnvFile -Root $Root | Out-Null
Sync-AlwatanLanConfig -Root $Root -LanIp $lanIp -LanIps $networkIps

Ensure-AlwatanPrivateNetwork | Out-Null

$fwPorts = if ($Dev) { @(4000, 5173) } else { @(4000) }
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
if ($prodUrl -and -not $Dev) {
    $clientDir = Publish-AlwatanClientAccess -ServerIps $networkIps -Port 4000 -Root $Root
    Write-Host "Application déjà active : $prodUrl" -ForegroundColor Green
    Show-AlwatanNetworkUrls -LanIp $lanIp
    Open-AlwatanBrowser -Url $prodUrl
    exit 0
}

if ($Dev) {
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
$backendCmd = @"
`$env:Path='$nodeDir;'+`$env:Path
`$env:HOST='0.0.0.0'
`$env:SERVE_FRONTEND='1'
`$env:CORS_ORIGIN='$corsOrigin'
Set-Location '$be'
npm.cmd run start
"@
Start-Process powershell -ArgumentList @('-NoExit', '-Command', $backendCmd)

$url = Wait-AlwatanProductionUrl -HostName '127.0.0.1' -Port 4000
if (-not $url) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message 'Le serveur met trop de temps à démarrer. Vérifiez la fenêtre npm run start.' -Type Warning
    exit 1
}

$clientDir = Publish-AlwatanClientAccess -ServerIps $networkIps -Port 4000 -Root $Root
Open-AlwatanBrowser -Url $url

Write-Host ''
Write-Host 'Application prête sur ce poste :' -ForegroundColor Green
Write-Host "  $url"
Show-AlwatanNetworkUrls -LanIp $lanIp
Write-Host ''
