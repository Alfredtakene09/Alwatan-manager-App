#Requires -RunAsAdministrator
# Corrige la passerelle Ethernet morte + pare-feu LAN (port 4000).
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_alwatan-common.ps1"
. "$PSScriptRoot\_alwatan-access-ethernet.ps1"

$Root = Get-AlwatanRoot
Write-Host ''
Write-Host '  Alwatan - reparation acces Ethernet' -ForegroundColor Cyan
Write-Host ''

Repair-AlwatanEthernetLanRouting | Out-Null
Ensure-AlwatanPrivateNetwork | Out-Null
Ensure-AlwatanLanFirewall -Ports @(4000) | Out-Null
Apply-AlwatanEthernetTailscaleAccess -Root $Root -Port 4000 -ConfigureFirewall | Out-Null

Write-Host 'Reparation Ethernet terminee.' -ForegroundColor Green
Write-Host 'Relancez le serveur si les postes ne voient pas encore la page.' -ForegroundColor DarkGray
