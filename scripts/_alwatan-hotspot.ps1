# Partage de connexion Windows (accès fiable poste à poste)
$ErrorActionPreference = 'Stop'

function Get-AlwatanTetheringManager {
    [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
    [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
    $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if (-not $profile) { return $null }
    return [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
}

function Wait-WinRtAsync {
    param($AsyncOperation)

    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod } |
        Select-Object -First 1
    if (-not $asTask) {
        while ($AsyncOperation.Status -eq 'Started') { Start-Sleep -Milliseconds 150 }
        return $AsyncOperation.GetResults()
    }
    $task = $asTask.Invoke($null, @($AsyncOperation))
    $task.Wait()
    return $task.Result
}

function Get-AlwatanHotspotStatus {
    $manager = Get-AlwatanTetheringManager
    if (-not $manager) { return $null }

    $cfg = $manager.GetCurrentAccessPointConfiguration()
    $on = ($manager.TetheringOperationalState.ToString() -eq 'On')
    $pass = $null
    try { $pass = $cfg.Passphrase } catch { }

    return [PSCustomObject]@{
        Active = $on
        Ssid = $cfg.Ssid
        Passphrase = $pass
        ClientUrl = if ($on) { 'http://192.168.137.1:4000/' } else { $null }
    }
}

function Start-AlwatanMobileHotspot {
    $status = Get-AlwatanHotspotStatus
    if (-not $status) {
        Write-Host 'Connexion Internet introuvable — impossible d''activer le partage.' -ForegroundColor Yellow
        return $false
    }
    if ($status.Active) { return $true }

    $manager = Get-AlwatanTetheringManager
    try {
        $result = Wait-WinRtAsync ($manager.StartTetheringAsync())
        $ok = ($result.Status.ToString() -eq 'Success')
        if (-not $ok) {
            Write-Host "Partage refusé : $($result.Status)" -ForegroundColor Yellow
        }
        return $ok
    } catch {
        Write-Host "Partage de connexion : $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

function Show-AlwatanHotspotInstructions {
    param([string]$ClientFolder)

    $status = Get-AlwatanHotspotStatus
    if ($status -and $status.Active) {
        Write-Host ''
        Write-Host '  ═══ ACCÈS DES AUTRES POSTES (obligatoire) ═══' -ForegroundColor Green
        Write-Host '  Le Wi-Fi de la clinique bloque les PC entre eux.'
        Write-Host '  Chaque poste client doit se connecter au Wi-Fi du SERVEUR :' -ForegroundColor Yellow
        Write-Host ''
        Write-Host "    Réseau Wi-Fi : $($status.Ssid)" -ForegroundColor Cyan
        if ($status.Passphrase) {
            Write-Host "    Mot de passe   : $($status.Passphrase)" -ForegroundColor Cyan
        }
        Write-Host ''
        Write-Host '    Puis ouvrir : http://192.168.137.1:4000' -ForegroundColor Green
        if ($ClientFolder) {
            Write-Host "    Ou double-clic : $ClientFolder\Ouvrir Alwatan.bat"
        }
        Write-Host ''

        $body = @"
Les autres PC ne doivent PAS rester sur le Wi-Fi clinique.

1) Connectez chaque poste au Wi-Fi :
   $($status.Ssid)
$(if ($status.Passphrase) { "   Mot de passe : $($status.Passphrase)`n" })
2) Ouvrez :
   http://192.168.137.1:4000

(Le serveur reste connecté au Wi-Fi clinique pour la base de données.)
"@
        Show-AlwatanMessage -Title 'Alwatan — Connexion des postes' -Message $body
        return
    }

    Write-Host ''
    Write-Host '  Activez le partage de connexion (Paramètres > Réseau > Partage de connexion).' -ForegroundColor Yellow
    Start-Process 'ms-settings:network-mobilehotspot'
}
