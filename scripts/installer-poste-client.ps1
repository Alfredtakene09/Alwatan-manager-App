# Installe Alwatan Manager (client réseau) sur ce PC.
param(
    [string]$SourceDir = $PSScriptRoot,
    [string]$ServerIp = $null,
    [int]$Port = 4000,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $SourceDir '_alwatan-common.ps1')

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
set "WIFI_URL=$url"
set "TS_URL=$tsUrl"
powershell -NoProfile -Command "try { `$r=Invoke-WebRequest -Uri `$env:WIFI_URL -UseBasicParsing -TimeoutSec 3; if (`$r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
  start "" "%WIFI_URL%"
  exit /b 0
)
if defined TS_URL if not "%TS_URL%"=="" (
  start "" "%TS_URL%"
  exit /b 0
)
start "" "%WIFI_URL%"
"@
Set-Content -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan.bat') -Value $bat -Encoding ASCII

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
$shortcutDescription = "Clinique Alwatan — Wi-Fi + Tailscale ($url)"

# Bureau de l'utilisateur courant
$userDesktop = [Environment]::GetFolderPath('Desktop')
$desktopShortcut = Join-Path $userDesktop "$shortcutName.lnk"
New-ShortcutFile `
    -ShortcutPath $desktopShortcut `
    -TargetPath $launcherVbs `
    -WorkingDirectory $installDir `
    -Description $shortcutDescription `
    -IconPath $iconPath

# Raccourcis URL directs (Wi-Fi + Tailscale)
$desktopUrl = Join-Path $userDesktop 'Alwatan Manager (Wi-Fi).url'
Copy-Item -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan (Wi-Fi).url') -Destination $desktopUrl -Force
$desktopBat = Join-Path $userDesktop 'Alwatan Manager (direct).bat'
Copy-Item -LiteralPath (Join-Path $installDir 'Ouvrir Alwatan.bat') -Destination $desktopBat -Force
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
New-ShortcutFile `
    -ShortcutPath $startLnk `
    -TargetPath $launcherVbs `
    -WorkingDirectory $installDir `
    -Description "Ouvrir Alwatan Manager (Wi-Fi $ServerIp / Tailscale)" `
    -IconPath $iconPath

$readme = @"
Clinique Alwatan — Manager Pro (poste client)
Installé : $installDir
Wi-Fi    : $url
Tailscale: $(if ($tsUrl) { $tsUrl } else { '(non configuré)' })

Le raccourci principal teste d'abord le Wi-Fi, puis Tailscale.
Secours Bureau :
  « Alwatan Manager (Wi-Fi) »
  « Alwatan Manager (Tailscale) » (si disponible)
  « Alwatan Manager (direct) »
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
    Write-Host "  Menu Démarrer : $startLnk"
    Write-Host ''
    $msgTs = if ($tsUrl) { "`nTailscale : $tsUrl" } else { '' }
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Installation client terminée.`n`nRaccourci : $shortcutName`nWi-Fi : $url$msgTs"
}

Open-AlwatanBrowser -Url $url
