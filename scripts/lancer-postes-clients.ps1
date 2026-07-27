# Lance l'app + accès réseau fiable via partage de connexion Windows (postes clients).
. "$PSScriptRoot\_alwatan-common.ps1"
. "$PSScriptRoot\_alwatan-hotspot.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$networkIps = Get-AlwatanNetworkIps
$lanIp = Get-LocalLanIpv4

Write-Host ''
Write-Host '  Clinique Alwatan — Serveur + postes clients' -ForegroundColor Cyan
Write-Host ''

Ensure-AlwatanEnvFile -Root $Root | Out-Null
$hotspotIps = @('192.168.137.1') + $networkIps
Sync-AlwatanLanConfig -Root $Root -LanIp $lanIp -LanIps $hotspotIps

Ensure-AlwatanPrivateNetwork | Out-Null

if (-not (Ensure-AlwatanLanFirewall -Ports @(4000))) {
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $PSScriptRoot 'deploy\forcer-acces-lan.ps1')
        )
        Ensure-AlwatanLanFirewall -Ports @(4000) | Out-Null
    } catch { }
}

Write-Host 'Activation du partage de connexion (réseau direct PC à PC)...'
$hotspotOk = Start-AlwatanMobileHotspot
if (-not $hotspotOk) {
    Show-AlwatanHotspotInstructions
}

$be = Join-Path $Root 'backend'
$corsOrigin = Build-AlwatanCorsOrigin -LanIps $hotspotIps

if (-not (Test-AlwatanProductionApp -HostName '127.0.0.1' -Port 4000 -TimeoutSec 2)) {
    if (-not (Ensure-AlwatanProductionBuild -Root $Root -NodeDir $nodeDir)) {
        Show-AlwatanMessage -Title 'Alwatan' -Message 'Compilation échouée.' -Type Error
        exit 1
    }
    Stop-PortListeners -Ports @(4000, 5173)
    Write-Host 'Démarrage du serveur (port 4000)...'
    $backendCmd = @"
`$env:Path='$nodeDir;'+`$env:Path
`$env:HOST='0.0.0.0'
`$env:SERVE_FRONTEND='1'
`$env:CORS_ORIGIN='$corsOrigin'
Set-Location '$be'
npm.cmd run start
"@
    Start-Process powershell -ArgumentList @('-NoExit', '-Command', $backendCmd)
    $null = Wait-AlwatanProductionUrl -HostName '127.0.0.1' -Port 4000
} else {
    Write-Host 'Serveur déjà actif sur le port 4000.' -ForegroundColor Green
}

# URL clients : hotspot en priorité (seul chemin fiable si le Wi-Fi clinique isole les PC)
$clientIps = @('192.168.137.1')
if ($lanIp) { $clientIps += $lanIp }
$clientDir = Publish-AlwatanClientAccess -ServerIps $clientIps -Port 4000 -Root $Root

Open-AlwatanBrowser -Url 'http://127.0.0.1:4000/'
Show-AlwatanHotspotInstructions -ClientFolder $clientDir

Write-Host 'Serveur local : http://127.0.0.1:4000' -ForegroundColor Green
Write-Host "Dossier à copier sur les clients : $clientDir" -ForegroundColor Cyan
Write-Host ''
