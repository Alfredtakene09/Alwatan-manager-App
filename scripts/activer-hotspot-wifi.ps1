# Partage de connexion Windows — contourne l'isolation Wi-Fi de la box.
. "$PSScriptRoot\_alwatan-common.ps1"

Write-Host ''
Write-Host '  Hotspot Windows — accès direct PC à PC' -ForegroundColor Cyan
Write-Host ''
Write-Host '1. La fenêtre Paramètres va s''ouvrir : activez « Partage de connexion ».'
Write-Host '2. Notez le nom du réseau et le mot de passe Wi-Fi affichés.'
Write-Host '3. Sur chaque poste client : connectez-vous à CE Wi-Fi (pas le Wi-Fi clinique).'
Write-Host '4. Ouvrez : http://192.168.137.1:4000'
Write-Host '   ou double-cliquez Ouvrir Alwatan.bat après avoir relancé le serveur.'
Write-Host ''
Write-Host 'Le serveur doit rester connecté au Wi-Fi clinique (ou Ethernet) pour Internet/PostgreSQL.'
Write-Host ''

Start-Process 'ms-settings:network-mobilehotspot'

$hotspot = Get-AlwatanHotspotIpv4
if ($hotspot) {
    Write-Host "Hotspot déjà actif — URL clients : http://${hotspot}:4000" -ForegroundColor Green
}

Write-Host ''
Read-Host 'Appuyez sur Entrée pour fermer'
