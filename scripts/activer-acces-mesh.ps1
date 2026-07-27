# Tailscale — accès fiable entre postes même si le Wi-Fi clinique isole les PC.
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_alwatan-common.ps1"

Write-Host ''
Write-Host '  Alwatan — réseau mesh Tailscale (recommandé si le Wi-Fi bloque)' -ForegroundColor Cyan
Write-Host ''

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
    Write-Host "URL sur tous les postes Tailscale : http://${ip}:4000" -ForegroundColor Green
    Write-Host 'Installez Tailscale sur chaque PC client avec le MÊME compte (gratuit).'
    Write-Host 'Puis ouvrez la même URL dans le navigateur.'
} else {
    Write-Host 'Tailscale démarré — exécutez : tailscale ip -4' -ForegroundColor Yellow
}

Write-Host ''
Read-Host 'Appuyez sur Entrée pour fermer'
