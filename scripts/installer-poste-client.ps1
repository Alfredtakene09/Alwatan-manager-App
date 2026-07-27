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
if (-not $ServerIp -and (Test-Path $bundleConfig)) {
    foreach ($line in Get-Content $bundleConfig -ErrorAction SilentlyContinue) {
        if ($line -match '^\s*SERVER_IP\s*=\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})') {
            $ServerIp = $Matches[1]
            break
        }
    }
}
if (-not $ServerIp) {
    $ServerIp = Read-Host 'Adresse IP du serveur Alwatan (ex. 192.168.1.50)'
}
$ServerIp = $ServerIp.Trim()
if ($ServerIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "Adresse IP invalide : $ServerIp"
}

Set-Content -Path (Join-Path $installDir 'alwatan-server.txt') -Value "SERVER_IP=$ServerIp" -Encoding UTF8

$icon = Join-Path $installDir 'alwatan.ico'
if (-not (Test-Path $icon)) {
    $icon = Ensure-AlwatanIcon -Root $SourceDir -Force
    if ($icon) { Copy-Item $icon (Join-Path $installDir 'alwatan.ico') -Force }
}

$launcherVbs = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client' -ScriptsDir $installDir
$iconPath = Join-Path $installDir 'alwatan.ico'

$shortcutName = 'Alwatan Manager'
$shortcutDescription = "Clinique Alwatan — accès réseau (http://${ServerIp}:${Port})"

# Bureau de l'utilisateur courant
$userDesktop = [Environment]::GetFolderPath('Desktop')
$desktopShortcut = Join-Path $userDesktop "$shortcutName.lnk"
New-ShortcutFile `
    -ShortcutPath $desktopShortcut `
    -TargetPath $launcherVbs `
    -WorkingDirectory $installDir `
    -Description $shortcutDescription `
    -IconPath $iconPath

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
    -Description "Ouvrir Alwatan Manager (serveur $ServerIp)" `
    -IconPath $iconPath

$url = "http://${ServerIp}:${Port}/"
$readme = @"
Clinique Alwatan — Manager Pro (poste client)
Installé : $installDir
Serveur  : $url
"@
Set-Content -Path (Join-Path $installDir 'LISEZMOI.txt') -Value $readme -Encoding UTF8

if (-not $Quiet) {
    Write-Host ''
    Write-Host '  Installation terminée.' -ForegroundColor Green
    Write-Host "  Dossier : $installDir"
    Write-Host "  Serveur : $url"
    Write-Host "  Bureau  : $desktopShortcut"
    Write-Host "  Menu Démarrer : $startLnk"
    Write-Host ''
    Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Installation client terminée.`n`nRaccourci Bureau : $shortcutName`nServeur : $url"
}

Open-AlwatanBrowser -Url $url
