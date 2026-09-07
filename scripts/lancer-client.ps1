# Open Alwatan from a client workstation.
# Order: Ethernet/LAN (SERVER_IP) first, then Tailscale for the remote user.
param(
    [switch]$ForceHardReload
)

. "$PSScriptRoot\_alwatan-common.ps1"

$ErrorActionPreference = 'Continue'
$configuredIp = Read-AlwatanServerIp
$tailscaleIp = Read-AlwatanTailscaleIp

$lanIp = $null
$tsIp = $null
if ($configuredIp -and -not (Test-AlwatanTailscaleIpv4 $configuredIp)) {
    $lanIp = $configuredIp
} elseif ($configuredIp -and (Test-AlwatanTailscaleIpv4 $configuredIp)) {
    $tsIp = $configuredIp
    Write-AlwatanClientLaunchLog "WARN: SERVER_IP points to Tailscale ($configuredIp); missing Ethernet/LAN primary"
}
if ($tailscaleIp -and (Test-AlwatanTailscaleIpv4 $tailscaleIp)) {
    $tsIp = $tailscaleIp
} elseif ($tailscaleIp -and -not $lanIp) {
    $lanIp = $tailscaleIp
}

Write-AlwatanClientLaunchLog "Client launch LAN=$lanIp TS=$tsIp FORCE_HARD_RELOAD=$ForceHardReload dir=$PSScriptRoot"

function Open-ConfiguredServer {
    param(
        [Parameter(Mandatory = $true)][string]$Ip,
        [string]$Label = 'server'
    )

    if (Test-AlwatanApiReachable -HostName $Ip -Port 4000 -TimeoutSec 3) {
        $url = "http://${Ip}:4000/"
        Write-AlwatanClientLaunchLog "OK production ($Label): $url"
        try {
            $info = Invoke-RestMethod -Uri ("http://{0}:4000/api/client-setup/info?_={1}" -f $Ip, [guid]::NewGuid().ToString('N')) -TimeoutSec 4
            $wifiHost = $null
            $tsHost = $null
            if ($info.wifiUrl) {
                try { $wifiHost = ([uri]$info.wifiUrl).Host } catch {}
            }
            if ($info.tailscaleUrl) {
                try { $tsHost = ([uri]$info.tailscaleUrl).Host } catch {}
            }
            if (-not $wifiHost) { $wifiHost = $Ip }
            Update-AlwatanClientShortcutUrls -ServerIp $wifiHost -TailscaleIp $tsHost -InstallDir $PSScriptRoot
            Write-AlwatanClientLaunchLog "Synced alwatan-server.txt LAN=$wifiHost TS=$tsHost"
        } catch {
            Update-AlwatanClientShortcutUrls -ServerIp $Ip -TailscaleIp (Read-AlwatanTailscaleIp) -InstallDir $PSScriptRoot
            Write-AlwatanClientLaunchLog "WARN: could not sync server info ($($_.Exception.Message))"
        }
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

if ($lanIp) {
    if (Open-ConfiguredServer -Ip $lanIp -Label 'Ethernet/LAN') { exit 0 }
    Write-AlwatanClientLaunchLog "Ethernet/LAN unavailable ($lanIp); auto-discovery..."
}

# Decouverte automatique sur le reseau cable (IP DHCP du serveur peut changer)
$discovered = Find-AlwatanServerOnEthernetSubnet -Port 4000
if ($discovered) {
    Write-AlwatanClientLaunchLog "Auto-discovered server on LAN: $discovered"
    $tsHost = Read-AlwatanTailscaleIp
    Update-AlwatanClientShortcutUrls -ServerIp $discovered -TailscaleIp $tsHost -InstallDir $PSScriptRoot
    if (Open-ConfiguredServer -Ip $discovered -Label 'Ethernet-auto') { exit 0 }
}

if ($tsIp -and $tsIp -ne $lanIp -and $tsIp -ne $discovered) {
    if (Open-ConfiguredServer -Ip $tsIp -Label 'Tailscale') { exit 0 }
}

if ($lanIp) {
    $url = "http://${lanIp}:4000/"
    Write-AlwatanClientLaunchLog "Forced Ethernet/LAN open: $url"
    Open-AlwatanBrowser -Url $url -ForceHardReload:$ForceHardReload
    $tsHint = if ($tsIp) { "`nTailscale fallback: http://${tsIp}:4000/" } else { '' }
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Le navigateur s'ouvre sur le reseau Ethernet/LAN :
$url$tsHint

Si la page ne charge pas :
1) PC serveur allume + Alwatan Manager (Serveur) lance
2) PC client branche en Ethernet (meme reseau)
3) Verifiez l'IP Ethernet du serveur : $lanIp

Journal : %LOCALAPPDATA%\CliniqueAlwatan\last-launch.log
"@ -Type Warning
    exit 0
}

if ($tsIp) {
    $url = "http://${tsIp}:4000/"
    Write-AlwatanClientLaunchLog "Forced Tailscale open (no LAN IP): $url"
    Open-AlwatanBrowser -Url $url -ForceHardReload:$ForceHardReload
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Aucune IP Ethernet/LAN configuree.
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
   SERVER_IP=192.168.88.70
   TAILSCALE_IP=100.x.x.x
"@ -Type Warning
exit 1
