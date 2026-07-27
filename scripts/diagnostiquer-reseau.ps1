# Diagnostic accès réseau Alwatan Manager (à lancer sur le SERVEUR).
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$lanIp = Get-LocalLanIpv4
$ports = @(4000, 5173)

Write-Host ''
Write-Host '  Alwatan Manager — diagnostic réseau (poste SERVEUR)' -ForegroundColor Cyan
Write-Host ''

if (-not $lanIp) {
    Write-Host 'Aucune adresse IPv4 LAN détectée (Wi-Fi / Ethernet).' -ForegroundColor Red
    exit 1
}

Write-Host "IP LAN détectée : $lanIp" -ForegroundColor Green
Write-Host ''

Write-Host '--- Profil réseau Windows ---'
Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|Ethernet|WLAN|LAN' } |
    Format-Table InterfaceAlias, NetworkCategory, IPv4Connectivity -AutoSize

Write-Host '--- Écoute des ports (doit être 0.0.0.0) ---'
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
Write-Host '--- Pare-feu entrant (règles Alwatan) ---'
$rules = Get-NetFirewallRule -DisplayName '*Alwatan*' -ErrorAction SilentlyContinue
if (-not $rules) {
    Write-Host '  Aucune règle — exécutez en admin : scripts\ouvrir-parefeu-lan.cmd' -ForegroundColor Red
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
        Write-Host "  $url -> ÉCHEC" -ForegroundColor Red
    }
}
try {
    $h = Invoke-WebRequest -Uri "http://${lanIp}:4000/api/health" -UseBasicParsing -TimeoutSec 8
    Write-Host "  http://${lanIp}:4000/api/health -> $($h.StatusCode) OK" -ForegroundColor Green
} catch {
    Write-Host "  http://${lanIp}:4000/api/health -> ÉCHEC" -ForegroundColor Red
}

Write-Host ''
Write-Host '--- Test TCP local (IP LAN) ---'
foreach ($port in $ports) {
    $t = Test-NetConnection -ComputerName $lanIp -Port $port -WarningAction SilentlyContinue
    $label = if ($t.TcpTestSucceeded) { 'OK' } else { 'ÉCHEC' }
    $color = if ($t.TcpTestSucceeded) { 'Green' } else { 'Red' }
    Write-Host "  Test-NetConnection ${lanIp}:$port -> $label" -ForegroundColor $color
}

Write-Host ''
Write-Host '--- À faire sur un AUTRE ordinateur ---' -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\tester-poste-client.ps1 -ServerIp $lanIp"
Write-Host "  Ou : Test-NetConnection -ComputerName $lanIp -Port 4000"
Write-Host "  Puis navigateur : http://${lanIp}:4000"
Write-Host ''
Write-Host 'Si TcpTestSucceeded = False sur le client :' -ForegroundColor Yellow
Write-Host '  • Testez aussi le port 445 (tester-poste-client.ps1). Si 445 ET 4000 échouent → isolation Wi-Fi / VLAN, pas l''app.'
Write-Host '  • MikroTik / box : désactiver « AP isolation » / « Client isolation » sur le Wi-Fi.'
Write-Host '  • Même sous-réseau requis (ex. tous en 192.168.88.x).'
Write-Host '  • Sur le serveur (admin) : scripts\forcer-acces-lan.cmd puis redémarrer lancer-serveur.ps1'
Write-Host ''

$envPath = Join-Path $Root 'backend\.env'
if (Test-Path $envPath) {
    $hostLine = Select-String -Path $envPath -Pattern '^\s*HOST\s*=' | Select-Object -First 1
    if ($hostLine -and $hostLine.Line -notmatch '0\.0\.0\.0') {
        Write-Host 'ATTENTION : backend\.env HOST n''est pas 0.0.0.0 — redémarrez l''API après correction.' -ForegroundColor Yellow
    }
}

Write-Host "Fichier IP pour les clients : $(Join-Path $PSScriptRoot 'alwatan-server.txt')" -ForegroundColor DarkGray
Write-Host ''
