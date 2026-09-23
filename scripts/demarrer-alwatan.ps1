# Demarrage unique Alwatan — meme script serveur et postes clients.
# Fonctionne hors ligne (Ethernet LAN). Aucune connexion Internet requise.
#
# Usage :
#   .\scripts\demarrer-alwatan.ps1
#   ou double-clic sur DEMARRER-ALWATAN.cmd a la racine du projet
param(
    [ValidateSet('Auto', 'Serveur', 'Client')]
    [string]$Mode = 'Auto',
    [switch]$Boot,
    [switch]$ForceHardReload
)

$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\_alwatan-common.ps1"
$accessEth = Join-Path $PSScriptRoot '_alwatan-access-ethernet.ps1'
if (Test-Path $accessEth) { . $accessEth }

function Test-AlwatanThisMachineIsServer {
    $root = Get-AlwatanRoot
    $backendPkg = Join-Path $root 'backend\package.json'
    $frontendPkg = Join-Path $root 'frontend\package.json'
    if (-not ((Test-Path $backendPkg) -and (Test-Path $frontendPkg))) {
        return $false
    }
    # Dossier client installe : pas de backend complet
    if ($PSScriptRoot -like '*\CliniqueAlwatan\Alwatan Manager') {
        return $false
    }
    if ($PSScriptRoot -like '*\setup-client\*') {
        return $false
    }
    if ($PSScriptRoot -like '*\acces-client\*') {
        return $false
    }
    return $true
}

function Wait-AlwatanEthernetIp {
    param([int]$TimeoutSec = 25)

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $eth = $null
        if (Get-Command Get-AlwatanEthernetIpv4 -ErrorAction SilentlyContinue) {
            $eth = Get-AlwatanEthernetIpv4
        }
        if (-not $eth) { $eth = Get-LocalLanIpv4 }
        if ($eth) { return $eth }
        Start-Sleep -Milliseconds 800
    }
    return $null
}

function Show-AlwatanEthernetBanner {
    param([string]$Role)

    $eth = $null
    if (Get-Command Get-AlwatanEthernetIpv4 -ErrorAction SilentlyContinue) {
        $eth = Get-AlwatanEthernetIpv4
    }
    if (-not $eth) { $eth = Get-LocalLanIpv4 }

    Write-Host ''
    Write-Host '  Clinique Alwatan - Manager Pro' -ForegroundColor Cyan
    Write-Host ("  Role : {0}  |  Hors ligne OK (Ethernet)" -f $Role) -ForegroundColor Cyan
    if ($eth) {
        Write-Host ("  Ethernet : http://{0}:4000" -f $eth) -ForegroundColor Green
    } else {
        Write-Host '  Ethernet : cable non detecte ou IP en attente (DHCP)...' -ForegroundColor Yellow
    }
    Write-Host ''
    return $eth
}

# ---------------------------------------------------------------------------
# Detection du role
# ---------------------------------------------------------------------------
$resolvedMode = $Mode
if ($Mode -eq 'Auto') {
    if (Test-AlwatanThisMachineIsServer) {
        $resolvedMode = 'Serveur'
    } else {
        $resolvedMode = 'Client'
    }
}

$ethIp = Show-AlwatanEthernetBanner -Role $resolvedMode
Write-AlwatanClientLaunchLog "demarrer-alwatan Mode=$resolvedMode Eth=$ethIp Boot=$Boot"

if ($resolvedMode -eq 'Serveur') {
    # Attendre une IP Ethernet si le cable vient d'etre branche (DHCP)
    if (-not $ethIp) {
        Write-Host 'Attente IP Ethernet (cable branche ?)...' -ForegroundColor Yellow
        $ethIp = Wait-AlwatanEthernetIp -TimeoutSec 25
        if ($ethIp) {
            Write-Host ("  IP Ethernet obtenue : http://{0}:4000" -f $ethIp) -ForegroundColor Green
        } else {
            Write-Host '  Pas d''IP Ethernet pour l''instant — demarrage quand meme (localhost).' -ForegroundColor Yellow
            Write-Host '  Branchez le cable Ethernet puis relancez si les clients ne voient pas le serveur.' -ForegroundColor Yellow
        }
    }

    # Publier l'IP Ethernet pour les clients (alwatan-server.txt)
    if ($ethIp) {
        $tsIp = Get-TailscaleIpv4
        Write-AlwatanServerConfig -ServerIp $ethIp -TailscaleIp $tsIp
        Sync-AlwatanLanConfig -Root (Get-AlwatanRoot) -LanIp $ethIp -LanIps @($ethIp)
    }

    $serveurScript = Join-Path $PSScriptRoot 'lancer-serveur.ps1'
    if ($Boot) {
        & $serveurScript -Production -Boot
    } else {
        & $serveurScript -Production
    }
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Client : ouvrir l'app sur l'IP Ethernet du serveur (sans Internet)
# ---------------------------------------------------------------------------
$clientScript = Join-Path $PSScriptRoot 'lancer-client.ps1'
if (-not (Test-Path $clientScript)) {
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Script client introuvable.

Sur le PC serveur : double-cliquez DEMARRER-ALWATAN.cmd
Sur un autre PC : copiez le dossier acces-client (ou setup-client) puis relancez.
"@ -Type Error
    exit 1
}

if ($ForceHardReload) {
    & $clientScript -ForceHardReload
} else {
    & $clientScript
}
exit $LASTEXITCODE
