# Tailscale — secours UNIQUEMENT si le Wi-Fi clinique isole les PC.
# Sur le même réseau local, utilisez directement l'IP LAN (Tailscale non requis).
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_alwatan-common.ps1"

$lanIp = Get-LocalLanIpv4

Write-Host ''
Write-Host '  Alwatan — réseau mesh Tailscale (secours optionnel)' -ForegroundColor Cyan
Write-Host ''
if ($lanIp) {
    Write-Host "  Même réseau ? Essayez d'abord : http://${lanIp}:4000" -ForegroundColor Green
    Write-Host '  Tailscale n''est nécessaire que si cette adresse ne répond pas depuis les autres PC.' -ForegroundColor DarkGray
    Write-Host ''
}

$ts = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $ts) {
    Write-Host 'Installation de Tailscale (winget)...' -ForegroundColor Yellow
    winget install --id Tailscale.Tailscale -e --accept-package-agreements --accept-source-agreements
    $ts = Get-Command tailscale -ErrorAction SilentlyContinue
}

if (-not $ts) {
    Write-Host 'Tailscale non installé. Téléchargez-le sur https://tailscale.com/download/windows' -ForegroundColor Red
    Start-Process 'https://tailscale.com/download/windows'
    exit 1
}

Write-Host 'Connexion du compte Tailscale (fenêtre à suivre)...' -ForegroundColor Yellow
& tailscale up

$ip = Get-TailscaleIpv4
if ($ip) {
    Write-Host ''
    Write-Host "URL Tailscale (secours) : http://${ip}:4000" -ForegroundColor Green
    Write-Host 'Installez Tailscale sur chaque PC client avec le MÊME compte (gratuit).'
    Write-Host 'Puis ouvrez la même URL dans le navigateur.'
    Write-Host ''
    Write-Host 'Rappel : les PC déjà sur le même Wi-Fi/Ethernet peuvent garder l''IP LAN.' -ForegroundColor Cyan
} else {
    Write-Host 'Tailscale démarré — exécutez : tailscale ip -4' -ForegroundColor Yellow
}

Write-Host ''
Read-Host 'Appuyez sur Entrée pour fermer'
