# Diagnostic acces reseau Alwatan Manager (a lancer sur le SERVEUR).
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$lanIp = Get-LocalLanIpv4
$ports = @(4000, 5173)

Write-Host ''
Write-Host '  Alwatan Manager - diagnostic reseau (poste SERVEUR)' -ForegroundColor Cyan
Write-Host ''

if (-not $lanIp) {
    Write-Host 'Aucune adresse IPv4 LAN detectee (Ethernet).' -ForegroundColor Red
    exit 1
}

Write-Host "IP LAN detectee : $lanIp" -ForegroundColor Green
Write-Host ''

Write-Host '--- Profil reseau Windows ---'
Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|Ethernet|WLAN|LAN' } |
    Format-Table InterfaceAlias, NetworkCategory, IPv4Connectivity -AutoSize

Write-Host '--- Ecoute des ports (doit etre 0.0.0.0) ---'
foreach ($port in $ports) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $listeners) {
        Write-Host "  TCP $port : aucun service (lancez lancer-serveur.ps1)" -ForegroundColor Yellow
        continue
    }
    foreach ($l in $listeners) {
        $color = if ($l.LocalAddress -eq '0.0.0.0') { 'Green' } else { 'Yellow' }
        Write-Host "  TCP $port : $($l.LocalAddress) (PID $($l.OwningProcess))" -ForegroundColor $color
    }
}

Write-Host ''
Write-Host '--- Pare-feu entrant (regles Alwatan) ---'
$rules = Get-NetFirewallRule -DisplayName '*Alwatan*' -ErrorAction SilentlyContinue
if (-not $rules) {
    Write-Host '  Aucune regle - executez en admin : scripts\configurer-acces-ethernet-tailscale.cmd' -ForegroundColor Red
} else {
    $rules | Format-Table DisplayName, Enabled, Profile, Direction -AutoSize
}

Write-Host '--- Tests HTTP depuis ce PC (via IP LAN) ---'
foreach ($port in $ports) {
    $url = "http://${lanIp}:$port/"
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
        Write-Host "  $url -> $($r.StatusCode) OK" -ForegroundColor Green
    } catch {
        Write-Host "  $url -> ECHEC" -ForegroundColor Red
    }
}
try {
    $h = Invoke-WebRequest -Uri "http://${lanIp}:4000/api/health" -UseBasicParsing -TimeoutSec 8
    Write-Host "  http://${lanIp}:4000/api/health -> $($h.StatusCode) OK" -ForegroundColor Green
} catch {
    Write-Host "  http://${lanIp}:4000/api/health -> ECHEC" -ForegroundColor Red
}

Write-Host ''
Write-Host '--- Test TCP local (IP LAN) ---'
foreach ($port in $ports) {
    $t = Test-NetConnection -ComputerName $lanIp -Port $port -WarningAction SilentlyContinue
    $label = if ($t.TcpTestSucceeded) { 'OK' } else { 'ECHEC' }
    $color = if ($t.TcpTestSucceeded) { 'Green' } else { 'Red' }
    Write-Host "  Test-NetConnection ${lanIp}:$port -> $label" -ForegroundColor $color
}

Write-Host ''
Write-Host '--- A faire sur un AUTRE ordinateur ---' -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\tester-poste-client.ps1 -ServerIp $lanIp"
Write-Host "  Ou : Test-NetConnection -ComputerName $lanIp -Port 4000"
Write-Host "  Puis navigateur : http://${lanIp}:4000"
Write-Host ''
Write-Host 'Si TcpTestSucceeded = False sur le client :' -ForegroundColor Yellow
Write-Host '  - Testez aussi le port 445. Si 445 ET 4000 echouent : isolation reseau / VLAN.'
Write-Host '  - Meme sous-reseau requis (ex. tous en 192.168.1.x).'
Write-Host '  - Sur le serveur (admin) : scripts\configurer-acces-ethernet-tailscale.cmd'
Write-Host ''

$envPath = Join-Path $Root 'backend\.env'
if (Test-Path $envPath) {
    $hostLine = Select-String -Path $envPath -Pattern '^\s*HOST\s*=' | Select-Object -First 1
    if ($hostLine -and $hostLine.Line -notmatch '0\.0\.0\.0') {
        Write-Host 'ATTENTION : backend\.env HOST nest pas 0.0.0.0 - redemarrez l API.' -ForegroundColor Yellow
    }
}

$clientIpFile = Join-Path $PSScriptRoot 'alwatan-server.txt'
Write-Host "Fichier IP pour les clients : $clientIpFile" -ForegroundColor DarkGray
Write-Host ''
