# Politique d'acces Alwatan :
# - PC cabinet : uniquement via cable Ethernet (IP Ethernet du serveur)
# - 1 utilisateur distant : Tailscale (PC, mobile, tablette)
# Executer en Administrateur pour appliquer le pare-feu.

param(
    [switch]$SkipFirewall,
    [switch]$RestartServer
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_alwatan-common.ps1"
. "$PSScriptRoot\_alwatan-access-ethernet.ps1"

$Root = Get-AlwatanRoot
Write-Host ''
Write-Host '  Alwatan - acces Ethernet + Tailscale' -ForegroundColor Cyan
Write-Host '  PC locaux = cable Ethernet | Distant = Tailscale uniquement' -ForegroundColor DarkGray
Write-Host ''

$eth = Get-AlwatanEthernetIpv4
$wifi = Get-AlwatanWifiIpv4List
$ts = Get-TailscaleIpv4

Write-Host "  Ethernet detecte (auto/DHCP) : $(if ($eth) { $eth } else { '(aucun)' })"
Write-Host "  Wi-Fi serveur                : $(if ($wifi.Count) { $wifi -join ', ' } else { '(aucun)' })"
Write-Host "  Tailscale                    : $(if ($ts) { $ts } else { '(aucun)' })"
Write-Host ''

if (-not $eth) {
    $dup = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.InterfaceAlias -match '(?i)^Ethernet' -and
            $_.AddressState -eq 'Duplicate'
        } |
        Select-Object -First 1
    if ($dup) {
        Write-Host "IP Ethernet en conflit (Duplicate) : $($dup.IPAddress)" -ForegroundColor Red
        Write-Host 'Laissez DHCP obtenir une nouvelle IP, ou changez l''IP manuelle en conflit.' -ForegroundColor Yellow
        Write-Host ''
        Write-Host "En attendant : PC = http://$($wifi[0]):4000/ | Tailscale = http://${ts}:4000/" -ForegroundColor DarkGray
    } else {
        Write-Host 'Branchez le cable Ethernet du serveur (DHCP automatique), puis relancez.' -ForegroundColor Red
    }
    exit 1
}

$ok = Apply-AlwatanEthernetTailscaleAccess `
    -Root $Root `
    -Port 4000 `
    -ConfigureFirewall:(-not $SkipFirewall)

if (-not $ok) { exit 1 }

Write-Host 'A faire sur les postes cabinet :' -ForegroundColor Cyan
Write-Host '  1. Brancher chaque PC en Ethernet (meme reseau / DHCP).'
Write-Host '  2. Lancer le raccourci Alwatan : connexion automatique au serveur.'
Write-Host "  3. URL directe : http://${eth}:4000/ (IP detectee automatiquement)."
Write-Host ''
Write-Host 'Pour l''utilisateur Tailscale (hors site / mobile) :' -ForegroundColor Cyan
Write-Host '  1. Installer Tailscale avec le meme compte que le serveur.'
Write-Host "  2. Ouvrir http://${ts}:4000/ depuis PC, telephone ou tablette."
Write-Host '  3. Ne pas installer Tailscale sur les autres PC cabinet (Ethernet suffit).'
Write-Host ''
Write-Host 'Note : l''IP Ethernet du serveur est detectee automatiquement (DHCP).'
Write-Host 'Si elle change, le lanceur client retrouve le serveur sur le reseau.'
Write-Host ''

if ($RestartServer) {
    Write-Host 'Redemarrage du serveur...' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'lancer-serveur.ps1') -Production
}

Write-Host 'Configuration enregistree (scripts\alwatan-server.txt + backend\.env).' -ForegroundColor Green
