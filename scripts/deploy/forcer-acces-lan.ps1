# Renforce pare-feu + vérifie réseau pour accès LAN (poste SERVEUR).
#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\_alwatan-common.ps1"

$ports = @(4000, 5173)
$lanIp = Get-LocalLanIpv4

Write-Host ''
Write-Host '  Alwatan — forcer accès réseau local' -ForegroundColor Cyan
Write-Host ''

Ensure-AlwatanPrivateNetwork | Out-Null

foreach ($port in $ports) {
    $name = "Alwatan Manager LAN TCP $port"
    $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    if ($existing) {
        Enable-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Out-Null
    } else {
        New-NetFirewallRule `
            -DisplayName $name `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort $port `
            -Profile Any `
            -Description "Acces reseau local Clinique Alwatan Manager (TCP $port)" | Out-Null
    }
}

Ensure-AlwatanLanFirewallNetsh -Ports $ports | Out-Null

# Règles Node.js Windows : souvent seulement « Public » — compléter Privé / Domaine
Ensure-AlwatanNodeFirewall

Write-Host 'Pare-feu : règles TCP 4000, 5173 et Node.js (Privé) appliquées.' -ForegroundColor Green

if ($lanIp) {
    Write-Host "IP LAN du serveur : $lanIp" -ForegroundColor Green
    Write-Host "URL clients       : http://${lanIp}:4000"
} else {
    Write-Host 'IP LAN introuvable — vérifiez Wi-Fi / Ethernet.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '--- Si les autres PC ont encore TcpTestSucceeded = False ---' -ForegroundColor Yellow
Write-Host 'Ce n''est en général PAS l''application mais le réseau Wi-Fi :'
Write-Host '  1. Sur un client : ping' $lanIp
Write-Host '     • Ping OK + port 4000 KO  → relancez ce script, vérifiez antivirus.'
Write-Host '     • Ping KO                 → isolation clients (AP isolation) ou VLAN différent.'
Write-Host '  2. Box / MikroTik : désactiver « isolation des clients » / « AP isolation » sur le Wi-Fi.'
Write-Host '  3. Brancher le serveur en Ethernet (câble) sur le même switch que les postes.'
Write-Host '  4. Vérifier que les clients ont une IP du même réseau (ex. 192.168.88.x).'
Write-Host ''
Write-Host 'Test client : scripts\tester-poste-client.ps1 -ServerIp' $lanIp
Write-Host ''
