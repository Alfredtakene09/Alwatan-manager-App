# Ouvre Alwatan sur un poste client (sans PowerShell compliqué).
# Essaie Wi-Fi / Ethernet puis Tailscale (les deux adresses sont dans alwatan-server.txt).
. "$PSScriptRoot\_alwatan-common.ps1"

$ErrorActionPreference = 'Continue'
$configuredIp = Read-AlwatanServerIp
$tailscaleIp = Read-AlwatanTailscaleIp
Write-AlwatanClientLaunchLog "Lancement client — SERVER_IP=$configuredIp TAILSCALE_IP=$tailscaleIp — dir=$PSScriptRoot"

function Open-ConfiguredServer {
    param(
        [Parameter(Mandatory = $true)][string]$Ip,
        [string]$Label = 'serveur'
    )

    # 1) Production cabinet (port 4000)
    if (Test-AlwatanProductionApp -HostName $Ip -Port 4000 -TimeoutSec 3) {
        $url = "http://${Ip}:4000/"
        Write-AlwatanClientLaunchLog "OK production ($Label) : $url"
        Open-AlwatanBrowser -Url $url
        return $true
    }

    # 2) Mode développement (Vite 5173) si le serveur tourne en Dev
    if (Test-AlwatanFrontend -HostName $Ip -FrontendPort 5173 -TimeoutSec 2) {
        $url = "http://${Ip}:5173/"
        Write-AlwatanClientLaunchLog "OK vite ($Label) : $url"
        Open-AlwatanBrowser -Url $url
        return $true
    }

    return $false
}

$orderedIps = [System.Collections.Generic.List[string]]::new()
$seenIp = @{}
function Add-TryIp([string]$Value) {
    if (-not $Value) { return }
    if ($seenIp.ContainsKey($Value)) { return }
    $seenIp[$Value] = $true
    [void]$orderedIps.Add($Value)
}

Add-TryIp $configuredIp
Add-TryIp $tailscaleIp

foreach ($ip in $orderedIps) {
    $label = if (Test-AlwatanTailscaleIpv4 $ip) { 'Tailscale' } else { 'Wi-Fi' }
    if (Open-ConfiguredServer -Ip $ip -Label $label) {
        exit 0
    }
}

# Aucune IP joignable : ouvrir quand même la première (évite « rien ne se passe »)
if ($configuredIp) {
    $url = "http://${configuredIp}:4000/"
    Write-AlwatanClientLaunchLog "Serveur non joignable — ouverture forcée Wi-Fi : $url"
    Open-AlwatanBrowser -Url $url
    $tsHint = if ($tailscaleIp) { "`nTailscale (secours) : http://${tailscaleIp}:4000/" } else { '' }
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Le navigateur s'ouvre sur :
$url$tsHint

Si la page ne charge pas :
1) Vérifiez que le PC serveur est allumé
2) Même Wi-Fi / Ethernet que le serveur
   OU Tailscale connecté sur les deux postes
3) Sur le serveur, lancez « Alwatan Manager (Serveur) » en mode cabinet (port 4000)

Journal : %LOCALAPPDATA%\CliniqueAlwatan\last-launch.log
"@ -Type Warning
    exit 0
}

if ($tailscaleIp) {
    $url = "http://${tailscaleIp}:4000/"
    Write-AlwatanClientLaunchLog "Ouverture forcée Tailscale : $url"
    Open-AlwatanBrowser -Url $url
    exit 0
}

# Pas d'IP configurée : essais locaux / hotspot
$urls = @(
    'http://192.168.137.1:4000/'
)
$seen = @{}
foreach ($url in $urls) {
    $hostName = ([Uri]$url).Host
    if ($seen.ContainsKey($hostName)) { continue }
    $seen[$hostName] = $true
    if (Test-AlwatanProductionApp -HostName $hostName -Port 4000 -TimeoutSec 2) {
        Write-AlwatanClientLaunchLog "OK hotspot : $url"
        Open-AlwatanBrowser -Url $url
        exit 0
    }
}

$server = Find-AlwatanServer
if ($server) {
    Write-AlwatanClientLaunchLog "OK auto : $($server.Url)"
    Open-AlwatanBrowser -Url $server.Url
    exit 0
}

if (Test-Path (Join-Path (Get-AlwatanRoot) 'backend\package.json')) {
    & (Join-Path $PSScriptRoot 'lancer-postes-clients.ps1')
    exit $LASTEXITCODE
}

Write-AlwatanClientLaunchLog 'ECHEC : aucune IP serveur'
Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Connexion impossible — aucune adresse serveur.

1) Réinstallez avec INSTALLER.bat (dossier acces-client)
2) Ou créez le fichier alwatan-server.txt avec :
   SERVER_IP=192.168.88.161
   TAILSCALE_IP=100.x.x.x
   (remplacez par les IP du serveur)

3) Même Wi-Fi / Ethernet OU Tailscale connecté
"@ -Type Warning
exit 1
