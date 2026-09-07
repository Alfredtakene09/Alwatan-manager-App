# Installe Alwatan Manager (client réseau) sur ce PC.
param(
    [string]$SourceDir = $PSScriptRoot,
    [string]$ServerIp = $null,
    [int]$Port = 4000,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $SourceDir '_alwatan-common.ps1')

try {
    Get-ChildItem -LiteralPath $SourceDir -Filter '*.ps1' -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $SourceDir -Filter '*.bat' -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue
} catch { }

trap {
    Write-Host ''
    Write-Host "ERREUR installation : $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace }
    exit 1
}

function New-ShortcutFile {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [string]$Description = '',
        [string]$IconPath = $null
    )

    $parentDir = Split-Path $ShortcutPath -Parent
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($ShortcutPath)
    $lnk.TargetPath = $TargetPath
    $lnk.WorkingDirectory = $WorkingDirectory
    if ($Description) { $lnk.Description = $Description }
    if ($IconPath -and (Test-Path $IconPath)) {
        $lnk.IconLocation = "$(Resolve-Path $IconPath),0"
    }
    $lnk.Save()
}

$installDir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\Alwatan Manager'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

$filesToInstall = @(
    '_alwatan-common.ps1',
    'lancer-client.ps1',
    'alwatan-server.txt.example',
    'tester-poste-client.ps1',
    'alwatan.ico'
)

foreach ($name in $filesToInstall) {
    $src = Join-Path $SourceDir $name
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $installDir $name) -Force
    }
}

$bundleConfig = Join-Path $SourceDir 'alwatan-server.txt'
$TailscaleIp = $null
if (-not $ServerIp -and (Test-Path $bundleConfig)) {
    foreach ($line in Get-Content $bundleConfig -ErrorAction SilentlyContinue) {
        if (-not $ServerIp -and $line -match '^\s*SERVER_IP\s*=\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})') {
            $ServerIp = $Matches[1]
        }
        if ($line -match '^\s*TAILSCALE_IP\s*=\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})') {
            $TailscaleIp = $Matches[1]
        }
    }
}
if (-not $ServerIp) {
    $ServerIp = Read-Host 'Adresse IP Wi-Fi du serveur Alwatan (ex. 192.168.1.50)'
}
$ServerIp = $ServerIp.Trim()
if ($ServerIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "Adresse IP invalide : $ServerIp"
}
if (Test-AlwatanTailscaleIpv4 $ServerIp) {
    throw "SERVER_IP doit être l'IP Wi-Fi du serveur (ex. 192.168.88.161), pas Tailscale ($ServerIp)."
}
if (-not $TailscaleIp) {
    $TailscaleIp = Read-AlwatanTailscaleIp
}

Write-AlwatanServerConfig -ServerIp $ServerIp -TailscaleIp $TailscaleIp -Path (Join-Path $installDir 'alwatan-server.txt')

$icon = Join-Path $installDir 'alwatan.ico'
if (-not (Test-Path $icon)) {
    $icon = Ensure-AlwatanIcon -Root $SourceDir -Force
    if ($icon) { Copy-Item $icon (Join-Path $installDir 'alwatan.ico') -Force }
}

$launcherVbs = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client' -ScriptsDir $installDir
$iconPath = Join-Path $installDir 'alwatan.ico'

$url = "http://${ServerIp}:${Port}/"
$tsUrl = if ($TailscaleIp -and $TailscaleIp -ne $ServerIp) { "http://${TailscaleIp}:${Port}/" } else { $null }

$lienLines = @("Wi-Fi / Ethernet : $($url.TrimEnd('/'))")
if ($tsUrl) { $lienLines += "Tailscale        : $($tsUrl.TrimEnd('/'))" }
$lienPath = Join-Path $installDir 'LIEN-SERVEUR.txt'
[System.IO.File]::WriteAllText($lienPath, ($lienLines -join "`r`n"), [System.Text.UTF8Encoding]::new($false))

$bat = @"
@echo off
title Alwatan Manager
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer-client.ps1"
if errorlevel 1 pause
"@
Set-Content -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan.bat') -Value $bat -Encoding ASCII

$batHard = @"
@echo off
title Alwatan Manager (rechargement force)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer-client.ps1" -ForceHardReload
if errorlevel 1 pause
"@
Set-Content -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan (rechargement force).bat') -Value $batHard -Encoding ASCII

$urlShortcut = @"
[InternetShortcut]
URL=$url
"@
Set-Content -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan.url') -Value $urlShortcut -Encoding ASCII
Set-Content -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan (Wi-Fi).url') -Value $urlShortcut -Encoding ASCII
if ($tsUrl) {
    $tsShortcut = @"
[InternetShortcut]
URL=$tsUrl
"@
    Set-Content -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan (Tailscale).url') -Value $tsShortcut -Encoding ASCII
}

$shortcutName = 'Alwatan Manager'
$shortcutDescription = "Clinique Alwatan - Wi-Fi + Tailscale ($url)"

# Bureau de l'utilisateur courant
$userDesktop = [Environment]::GetFolderPath('Desktop')
$desktopShortcut = Join-Path $userDesktop "$shortcutName.lnk"
try {
    New-ShortcutFile `
        -ShortcutPath $desktopShortcut `
        -TargetPath $launcherVbs `
        -WorkingDirectory $installDir `
        -Description $shortcutDescription `
        -IconPath $iconPath
} catch {
    Write-Host "Raccourci Bureau .lnk ignore : $($_.Exception.Message)" -ForegroundColor Yellow
}

# Raccourcis URL directs (Wi-Fi + Tailscale)
$desktopUrl = Join-Path $userDesktop 'Alwatan Manager (Wi-Fi).url'
Copy-Item -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan (Wi-Fi).url') -Destination $desktopUrl -Force
$desktopBat = Join-Path $userDesktop 'Alwatan Manager (direct).bat'
Copy-Item -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan.bat') -Destination $desktopBat -Force
$desktopHardBat = Join-Path $userDesktop 'Alwatan Manager (rechargement force).bat'
Copy-Item -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan (rechargement force).bat') -Destination $desktopHardBat -Force
if ($tsUrl) {
    Copy-Item -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan (Tailscale).url') `
        -Destination (Join-Path $userDesktop 'Alwatan Manager (Tailscale).url') -Force
}

# Bureau public (visible pour tous les comptes, utile si install exécutée en administrateur)
$publicDesktop = Join-Path $env:PUBLIC 'Desktop'
$publicShortcut = Join-Path $publicDesktop "$shortcutName.lnk"
try {
    New-ShortcutFile `
        -ShortcutPath $publicShortcut `
        -TargetPath $launcherVbs `
        -WorkingDirectory $installDir `
        -Description $shortcutDescription `
        -IconPath $iconPath
} catch {
    # Ne pas bloquer l'installation si le Bureau public n'est pas accessible.
}

$programs = [Environment]::GetFolderPath('Programs')
$startMenuDir = Join-Path $programs 'Clinique Alwatan'
New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
$startLnk = Join-Path $startMenuDir "$shortcutName.lnk"
try {
    New-ShortcutFile `
        -ShortcutPath $startLnk `
        -TargetPath $launcherVbs `
        -WorkingDirectory $installDir `
        -Description "Ouvrir Alwatan Manager (Wi-Fi $ServerIp / Tailscale)" `
        -IconPath $iconPath
} catch {
    Write-Host "Raccourci menu Demarrer ignore : $($_.Exception.Message)" -ForegroundColor Yellow
}

$readme = @"
Clinique Alwatan - Manager Pro (poste client)
Installe : $installDir
Ethernet : $url
Tailscale: $(if ($tsUrl) { $tsUrl } else { '(non configure)' })

Le raccourci principal teste d'abord Ethernet, puis Tailscale.
Secours Bureau :
  Alwatan Manager (Wi-Fi)
  Alwatan Manager (Tailscale) (si disponible)
  Alwatan Manager (direct)
  Alwatan Manager (rechargement force)  (purge cache + URL anti-cache)
"@
Set-Content -Path (Join-Path $installDir 'LISEZMOI.txt') -Value $readme -Encoding UTF8

if (-not $Quiet) {
    Write-Host ''
    Write-Host '  Installation terminée.' -ForegroundColor Green
    Write-Host "  Dossier : $installDir"
    Write-Host "  Wi-Fi   : $url"
    if ($tsUrl) { Write-Host "  Tailscale : $tsUrl" }
    Write-Host "  Bureau  : $desktopShortcut"
    Write-Host "  Secours : $desktopBat"
    Write-Host "  Reload+ : $desktopHardBat"
    Write-Host "  Menu Démarrer : $startLnk"
    Write-Host ''
    $msgTs = if ($tsUrl) { "`nTailscale : $tsUrl" } else { '' }
    try {
        Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Installation client terminee.`n`nRaccourci : $shortcutName`nEthernet : $url$msgTs"
    } catch {
        Write-Host "Installation client terminee. Ethernet : $url$msgTs"
    }
}

try {
    Open-AlwatanBrowser -Url $url
} catch {
    Write-Host "Navigateur non ouvert automatiquement. Ouvrez : $url" -ForegroundColor Yellow
}

$okMarker = Join-Path $SourceDir 'INSTALL-OK.txt'
Set-Content -LiteralPath $okMarker -Value ("OK " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "`r`n$url") -Encoding ASCII
$global:LASTEXITCODE = 0
exit 0
