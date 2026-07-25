# Démarre le serveur Alwatan Manager (API + interface) et ouvre le navigateur.
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$lanIp = Get-LocalLanIpv4

Write-Host ''
Write-Host '  Clinique Alwatan — Manager Pro' -ForegroundColor Cyan
Write-Host '  Démarrage du poste SERVEUR' -ForegroundColor Cyan
Write-Host ''

Ensure-AlwatanEnvFile -Root $Root | Out-Null

Write-Host 'Ouverture du pare-feu pour l''accès réseau (ports 4000 et 5173)...'
$firewallOk = Ensure-AlwatanLanFirewall -Ports @(4000, 5173)
if (-not $firewallOk) {
    $elevateScript = Join-Path $PSScriptRoot 'deploy\ouvrir-parefeu.ps1'
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', $elevateScript,
            '-IncludeDevPorts'
        )
        Ensure-AlwatanLanFirewall -Ports @(4000, 5173) | Out-Null
    } catch {
        Write-Host 'Élévation admin refusée ou échouée — les postes clients peuvent être bloqués.' -ForegroundColor Yellow
    }
}

$dbTest = Test-NetConnection -ComputerName localhost -Port 5433 -WarningAction SilentlyContinue
if (-not $dbTest.TcpTestSucceeded) {
    Write-Host 'ATTENTION : PostgreSQL inaccessible sur localhost:5433.' -ForegroundColor Yellow
    Write-Host 'Vérifiez que la base de données est démarrée avant de continuer.' -ForegroundColor Yellow
    Write-Host ''
}

$existingUrl = Get-AlwatanAppUrl -HostName '127.0.0.1'
if ($existingUrl) {
    if ($lanIp) {
        Write-Host "Interface déjà active : $existingUrl" -ForegroundColor Green
        Write-Host "  Sur le réseau   : http://${lanIp}:5173" -ForegroundColor Green
    } else {
        Write-Host "Interface déjà active : $existingUrl" -ForegroundColor Green
    }
    Open-AlwatanBrowser -Url $existingUrl
    exit 0
}

$apiRunning = Test-AlwatanApi -HostName '127.0.0.1'
$be = Join-Path $Root 'backend'
$fe = Join-Path $Root 'frontend'
$corsOrigin = Build-AlwatanCorsOrigin -LanIp $lanIp

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
    Write-Host '[1/2] API déjà active — démarrage de l''interface seulement...' -ForegroundColor Yellow
    Write-Host 'Libération du port 5173...'
    Stop-PortListeners -Ports @(5173)
}

if (-not $apiRunning) {
    Write-Host '[3/4] Démarrage API et interface...'
    $backendCmd = @"
`$env:Path='$nodeDir;'+`$env:Path
`$env:CORS_ORIGIN='$corsOrigin'
Set-Location '$be'
npm.cmd run dev
"@
    Start-Process powershell -ArgumentList @('-NoExit', '-Command', $backendCmd)
    Start-Sleep -Seconds 4
} else {
    Write-Host '[2/2] Démarrage de l''interface...'
}

$frontendCmd = @"
`$env:Path='$nodeDir;'+`$env:Path
Set-Location '$fe'
npm.cmd run dev
"@
Start-Process powershell -ArgumentList @('-NoExit', '-Command', $frontendCmd)

Write-Host 'Attente de l''interface et ouverture du navigateur...'
$url = Wait-AlwatanFrontend -HostName '127.0.0.1'
if (-not $url) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message 'L''interface met plus de temps que prévu à démarrer. Vérifiez la fenêtre « npm run dev » du frontend, puis ouvrez http://127.0.0.1:5173' -Type Warning
    exit 1
}

Open-AlwatanBrowser -Url $url

Write-Host ''
Write-Host 'Application prête :' -ForegroundColor Green
Write-Host "  Sur ce poste    : $url"
if ($lanIp) {
    Write-Host "  Sur le réseau   : http://${lanIp}:5173"
    Write-Host ''
    Write-Host 'Sur les postes clients, utilisez le raccourci « Alwatan Manager (Client) »' -ForegroundColor DarkGray
    Write-Host "ou renseignez $lanIp dans scripts\alwatan-server.txt" -ForegroundColor DarkGray
}
Write-Host ''
