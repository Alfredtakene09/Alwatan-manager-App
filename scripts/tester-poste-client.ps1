# Test de connexion au serveur Alwatan — à lancer sur un POSTE CLIENT.
param(
    [string]$ServerIp = $(Read-AlwatanServerIp)
)

. "$PSScriptRoot\_alwatan-common.ps1"

if (-not $ServerIp) {
    $ServerIp = Read-Host 'Adresse IP du serveur (ex. 192.168.88.161)'
}

$ServerIp = $ServerIp.Trim()
if ($ServerIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    Write-Host 'Adresse IP invalide.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host "  Test client → serveur $ServerIp" -ForegroundColor Cyan
Write-Host ''

$localIp = Get-LocalLanIpv4
if ($localIp) {
    Write-Host "IP de ce poste : $localIp"
    $serverPrefix = ($ServerIp -split '\.')[0..2] -join '.'
    $localPrefix = ($localIp -split '\.')[0..2] -join '.'
    if ($serverPrefix -ne $localPrefix) {
        Write-Host "ATTENTION : sous-réseau différent ($localPrefix vs $serverPrefix) — les PC ne se verront peut-être pas." -ForegroundColor Yellow
    }
}
Write-Host ''

Write-Host '--- Ping (ICMP) ---'
$ping = Test-Connection -ComputerName $ServerIp -Count 2 -Quiet -ErrorAction SilentlyContinue
if ($ping) {
    Write-Host "  ping $ServerIp : OK" -ForegroundColor Green
} else {
    Write-Host "  ping $ServerIp : échec (souvent normal si ICMP bloqué)" -ForegroundColor DarkYellow
}

Write-Host ''
Write-Host '--- Ports TCP ---'
foreach ($port in @(4000, 5173, 445)) {
    $t = Test-NetConnection -ComputerName $ServerIp -Port $port -WarningAction SilentlyContinue
    $label = if ($t.TcpTestSucceeded) { 'OK' } else { 'ÉCHEC' }
    $color = if ($t.TcpTestSucceeded) { 'Green' } else { 'Red' }
    $hint = switch ($port) {
        4000 { ' (application Alwatan — production)' }
        5173 { ' (mode dev Vite)' }
        445  { ' (partage Windows — test réseau local)' }
    }
    Write-Host "  TCP ${ServerIp}:$port$hint : $label" -ForegroundColor $color
}

Write-Host ''
$t4000 = Test-NetConnection -ComputerName $ServerIp -Port 4000 -WarningAction SilentlyContinue
$t445 = Test-NetConnection -ComputerName $ServerIp -Port 445 -WarningAction SilentlyContinue

if ($t4000.TcpTestSucceeded) {
    Write-Host "Ouvrez dans le navigateur : http://${ServerIp}:4000" -ForegroundColor Green
    exit 0
}

Write-Host 'Diagnostic :' -ForegroundColor Yellow
if (-not $t445.TcpTestSucceeded) {
    Write-Host '  Aucun port ne répond → isolation Wi-Fi (AP isolation), VLAN, ou mauvaise IP.'
    Write-Host '  Demandez à l''admin réseau de désactiver l''isolation des clients sur le point d''accès.'
    Write-Host '  Ou branchez les postes et le serveur sur le même switch Ethernet.'
} else {
    Write-Host '  Le réseau local fonctionne (445 OK) mais pas le port 4000.'
    Write-Host '  Sur le SERVEUR : exécutez scripts\forcer-acces-lan.cmd en administrateur, puis relancez l''application.'
}
Write-Host ''
exit 1
