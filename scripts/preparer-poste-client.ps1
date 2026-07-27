# Prépare un dossier client portable (Bureau) pour les postes sans le projet complet.
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$icon = Ensure-AlwatanIcon -Root $Root
$desktop = [Environment]::GetFolderPath('Desktop')
$clientDir = Join-Path $desktop 'Alwatan Manager Client'

New-Item -ItemType Directory -Path $clientDir -Force | Out-Null

$filesToCopy = @(
    '_alwatan-common.ps1',
    'lancer-client.ps1',
    'alwatan-server.txt.example'
)

foreach ($file in $filesToCopy) {
    Copy-Item (Join-Path $PSScriptRoot $file) (Join-Path $clientDir $file) -Force
}
Copy-Item (Join-Path $PSScriptRoot 'tester-poste-client.ps1') (Join-Path $clientDir 'tester-poste-client.ps1') -Force -ErrorAction SilentlyContinue

$configPath = Join-Path $clientDir 'alwatan-server.txt'
if (-not (Test-Path $configPath)) {
    Copy-Item (Join-Path $clientDir 'alwatan-server.txt.example') $configPath
}

if ($icon -and (Test-Path $icon)) {
    Copy-Item $icon (Join-Path $clientDir 'alwatan.ico') -Force
}

$clientVbs = Update-AlwatanSilentLauncher -ScriptBaseName 'lancer-client' -ScriptsDir $clientDir
$clientIcon = Ensure-AlwatanIcon -Root $Root -Force
if (-not $clientIcon) { $clientIcon = Join-Path $clientDir 'alwatan.ico' }
if ($clientIcon -and (Test-Path $clientIcon)) {
    Copy-Item $clientIcon (Join-Path $clientDir 'alwatan.ico') -Force
}

$shortcutPath = Join-Path $clientDir 'Alwatan Manager (Client).lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $clientVbs
$shortcut.WorkingDirectory = $clientDir
$shortcut.Description = 'Ouvrir Alwatan Manager (poste client)'
if ($clientIcon -and (Test-Path $clientIcon)) {
    $shortcut.IconLocation = "$(Resolve-Path $clientIcon),0"
}
$shortcut.Save()

$desktopShortcut = New-AlwatanDesktopShortcut `
    -Name 'Alwatan Manager (Client)' `
    -LauncherPath $clientVbs `
    -Description 'Ouvrir Alwatan Manager (poste client)' `
    -IconPath $clientIcon

Write-Host ''
Write-Host 'Dossier client créé :' -ForegroundColor Green
Write-Host "  $clientDir"
Write-Host "Raccourci Bureau : $desktopShortcut"
Write-Host ''
Write-Host 'Copiez le dossier sur les postes clients (clé USB, réseau…) ou utilisez le raccourci sur le Bureau.' -ForegroundColor Cyan
Write-Host "Configurez l'IP du serveur dans alwatan-server.txt si besoin." -ForegroundColor DarkGray
Write-Host ''

Show-AlwatanMessage -Title 'Alwatan Manager' -Message "Raccourci Bureau créé avec le logo Alwatan.`nLancement direct sans fenêtre noire.`n`nDossier portable :`nAlwatan Manager Client"
