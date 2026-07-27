# Test / activation partage de connexion (WinRT)
$ErrorActionPreference = 'Stop'

function Start-AlwatanMobileHotspot {
    try {
        [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
        [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]

        $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
        if (-not $profile) {
            Write-Host 'Pas de connexion Internet active pour le partage.'
            return $false
        }

        $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
        $state = $manager.TetheringOperationalState

        if ($state.ToString() -eq 'On') {
            Write-Host 'Partage de connexion deja actif.'
            return $true
        }

        $async = $manager.StartTetheringAsync()
        $awaiter = $async.GetAwaiter()
        while (-not $awaiter.IsCompleted) { Start-Sleep -Milliseconds 200 }
        $result = $awaiter.GetResult()
        $ok = ($result.Status.ToString() -eq 'Success')
        if (-not $ok) {
            Write-Host "StartTethering: $($result.Status)"
        }
        return $ok
    } catch {
        Write-Host "Hotspot: $($_.Exception.Message)"
        return $false
    }
}

function Get-AlwatanMobileHotspotInfo {
    try {
        [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
        [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
        $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
        if (-not $profile) { return $null }
        $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
        $cfg = $manager.GetCurrentAccessPointConfiguration()
        return @{
            Ssid = $cfg.Ssid
            On = ($manager.TetheringOperationalState.ToString() -eq 'On')
        }
    } catch {
        return $null
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ok = Start-AlwatanMobileHotspot
    $info = Get-AlwatanMobileHotspotInfo
    if ($info) { Write-Host "SSID: $($info.Ssid) On=$($info.On)" }
    exit $(if ($ok) { 0 } else { 1 })
}
