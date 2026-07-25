# Ouvre le pare-feu Windows pour l'accès LAN (API + interface production).
# À exécuter en Administrateur.

#Requires -RunAsAdministrator

param(
    [int]$Port = 4000,
    [int]$DevFrontendPort = 5173,
    [switch]$IncludeDevPorts
)

$ErrorActionPreference = 'Stop'

function Ensure-FirewallRule {
    param(
        [string]$Name,
        [int]$Port
    )

    $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Règle déjà présente : $Name" -ForegroundColor Yellow
        return
    }

    New-NetFirewallRule `
        -DisplayName $Name `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $Port `
        -Profile Private `
        -Description "Accès réseau local Clinique Alwatan Manager" | Out-Null

    Write-Host "Règle créée : $Name (TCP $Port, profil Privé)" -ForegroundColor Green
}

Ensure-FirewallRule -Name "Alwatan Manager API/Web ($Port)" -Port $Port
# Toujours ouvrir aussi le frontend Vite : usage courant en cabinet
Ensure-FirewallRule -Name "Alwatan Manager Frontend Dev ($DevFrontendPort)" -Port $DevFrontendPort
Ensure-FirewallRule -Name "Alwatan Manager LAN TCP $Port" -Port $Port
Ensure-FirewallRule -Name "Alwatan Manager LAN TCP $DevFrontendPort" -Port $DevFrontendPort

if ($IncludeDevPorts) {
    # Conservé pour compatibilité des appels existants
}

Write-Host ''
Write-Host "Pare-feu prêt. Les postes du réseau peuvent joindre TCP $Port et $DevFrontendPort." -ForegroundColor Cyan
