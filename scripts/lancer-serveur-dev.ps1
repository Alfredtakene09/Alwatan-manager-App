# Mode développeur uniquement (Vite 5173 + API 4000) — appelé par lancer-serveur.ps1 -Dev
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$lanIp = Get-LocalLanIpv4
$networkIps = Get-AlwatanNetworkIps -IncludeTailscale

$apiRunning = Test-AlwatanApi -HostName '127.0.0.1'
$be = Join-Path $Root 'backend'
$fe = Join-Path $Root 'frontend'
$corsOrigin = Build-AlwatanCorsOrigin -LanIps $networkIps

if (-not $apiRunning) {
    Write-Host '[1/4] Préparation des dépendances...'
    Push-Location $be
    & "$nodeDir\npm.cmd" install --silent 2>$null
    & "$nodeDir\npx.cmd" prisma generate 2>$null
    Pop-Location
    Push-Location $fe
    & "$nodeDir\npm.cmd" install --silent 2>$null
    Pop-Location
    Write-Host '[2/4] Libération des ports 4000 et 5173...'
    Stop-PortListeners -Ports @(4000, 5173)
} else {
    Write-Host 'API déjà active — interface seulement...' -ForegroundColor Yellow
    Stop-PortListeners -Ports @(5173)
}

if (-not $apiRunning) {
    Write-Host '[3/4] Démarrage API...'
    $apiLog = Join-Path (Get-AlwatanLogDir) 'server-api-dev.log'
    $apiCmd = "set `"PATH=$nodeDir;%PATH%`" && set HOST=0.0.0.0&& set `"CORS_ORIGIN=$corsOrigin`" && set SERVE_FRONTEND=0&& npm.cmd run dev"
    Start-AlwatanHiddenPowerShell -Command $apiCmd -WorkingDirectory $be -LogPath $apiLog -Title 'API dev'
    Start-Sleep -Seconds 4
}

Write-Host '[4/4] Démarrage interface Vite...'
$feLog = Join-Path (Get-AlwatanLogDir) 'server-frontend-dev.log'
$frontendCmd = "set `"PATH=$nodeDir;%PATH%`" && npm.cmd run dev"
Start-AlwatanHiddenPowerShell -Command $frontendCmd -WorkingDirectory $fe -LogPath $feLog -Title 'Frontend Vite'

$url = Wait-AlwatanFrontend -HostName '127.0.0.1'
if (-not $url) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message 'Interface lente. Ouvrez http://127.0.0.1:5173' -Type Warning
    exit 1
}

Publish-AlwatanClientAccess -ServerIps $networkIps -Port 4000 -Root $Root | Out-Null
Open-AlwatanBrowser -Url $url
Write-Host "Mode dev : $url"
Show-AlwatanNetworkUrls -LanIp $lanIp
