# Open Alwatan from a client workstation.
# Strict order: Wi-Fi/Ethernet first, Tailscale only as fallback.
param(
    [switch]$ForceHardReload
)

. "$PSScriptRoot\_alwatan-common.ps1"

$ErrorActionPreference = 'Continue'
$configuredIp = Read-AlwatanServerIp
$tailscaleIp = Read-AlwatanTailscaleIp

$wifiIp = $null
$tsIp = $null
if ($configuredIp -and -not (Test-AlwatanTailscaleIpv4 $configuredIp)) {
    $wifiIp = $configuredIp
} elseif ($configuredIp -and (Test-AlwatanTailscaleIpv4 $configuredIp)) {
    $tsIp = $configuredIp
    Write-AlwatanClientLaunchLog "WARN: SERVER_IP points to Tailscale ($configuredIp); missing Wi-Fi primary"
}
if ($tailscaleIp -and (Test-AlwatanTailscaleIpv4 $tailscaleIp)) {
    $tsIp = $tailscaleIp
} elseif ($tailscaleIp -and -not $wifiIp) {
    $wifiIp = $tailscaleIp
}

Write-AlwatanClientLaunchLog "Client launch WIFI=$wifiIp TS=$tsIp FORCE_HARD_RELOAD=$ForceHardReload dir=$PSScriptRoot"

function Open-ConfiguredServer {
    param(
        [Parameter(Mandatory = $true)][string]$Ip,
        [string]$Label = 'server'
    )

    if (Test-AlwatanApiReachable -HostName $Ip -Port 4000 -TimeoutSec 3) {
        $url = "http://${Ip}:4000/"
        Write-AlwatanClientLaunchLog "OK production ($Label): $url"
        Open-AlwatanBrowser -Url $url -ForceHardReload:$ForceHardReload
        return $true
    }

    if (Test-AlwatanFrontend -HostName $Ip -FrontendPort 5173 -TimeoutSec 2) {
        $url = "http://${Ip}:5173/"
        Write-AlwatanClientLaunchLog "OK vite ($Label): $url"
        Open-AlwatanBrowser -Url $url -ForceHardReload:$ForceHardReload
        return $true
    }

    return $false
}

if ($wifiIp) {
    if (Open-ConfiguredServer -Ip $wifiIp -Label 'Wi-Fi') { exit 0 }
    Write-AlwatanClientLaunchLog "Wi-Fi unavailable ($wifiIp); trying Tailscale fallback"
}

if ($tsIp -and $tsIp -ne $wifiIp) {
    if (Open-ConfiguredServer -Ip $tsIp -Label 'Tailscale') { exit 0 }
}

if ($wifiIp) {
    $url = "http://${wifiIp}:4000/"
    Write-AlwatanClientLaunchLog "Forced Wi-Fi open: $url"
    Open-AlwatanBrowser -Url $url -ForceHardReload:$ForceHardReload
    $tsHint = if ($tsIp) { "`nTailscale fallback: http://${tsIp}:4000/" } else { '' }
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Le navigateur s'ouvre sur le Wi-Fi :
$url$tsHint

Si la page ne charge pas :
1) PC serveur allume + Alwatan Manager (Serveur) lance
2) Meme Wi-Fi / Ethernet que le serveur
3) Verifiez l'IP Wi-Fi du serveur : $wifiIp

Journal : %LOCALAPPDATA%\CliniqueAlwatan\last-launch.log
"@ -Type Warning
    exit 0
}

if ($tsIp) {
    $url = "http://${tsIp}:4000/"
    Write-AlwatanClientLaunchLog "Forced Tailscale open (no Wi-Fi IP): $url"
    Open-AlwatanBrowser -Url $url -ForceHardReload:$ForceHardReload
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Aucune IP Wi-Fi configuree.
Ouverture Tailscale : $url
"@ -Type Warning
    exit 0
}

$urls = @('http://192.168.137.1:4000/')
$seen = @{}
foreach ($url in $urls) {
    $hostName = ([Uri]$url).Host
    if ($seen.ContainsKey($hostName)) { continue }
    $seen[$hostName] = $true
    if (Test-AlwatanApiReachable -HostName $hostName -Port 4000 -TimeoutSec 2) {
        Write-AlwatanClientLaunchLog "OK hotspot: $url"
        Open-AlwatanBrowser -Url $url -ForceHardReload:$ForceHardReload
        exit 0
    }
}

$server = Find-AlwatanServer
if ($server) {
    Write-AlwatanClientLaunchLog "OK auto: $($server.Url)"
    Open-AlwatanBrowser -Url $server.Url -ForceHardReload:$ForceHardReload
    exit 0
}

if (Test-Path (Join-Path (Get-AlwatanRoot) 'backend\package.json')) {
    & (Join-Path $PSScriptRoot 'lancer-postes-clients.ps1')
    exit $LASTEXITCODE
}

Write-AlwatanClientLaunchLog 'ERROR: no server IP'
Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Connexion impossible - aucune adresse serveur.

1) Reinstallez avec INSTALLER.bat
2) Ou creez alwatan-server.txt :
   SERVER_IP=192.168.88.161
   TAILSCALE_IP=100.x.x.x
"@ -Type Warning
exit 1
