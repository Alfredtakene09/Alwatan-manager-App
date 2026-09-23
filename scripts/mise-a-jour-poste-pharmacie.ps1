# Mise a jour manuelle du poste Pharmacie (cle USB).
# Impression = Microsoft Edge (plus d'agent ESC/POS).
param(
    [string]$SourceDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$utf8Bom = New-Object System.Text.UTF8Encoding $true

try {
    Get-ChildItem -LiteralPath $SourceDir -Filter '*.ps1' -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $SourceDir -Filter '*.cmd' -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $SourceDir -Filter '*.bat' -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue
} catch { }

. (Join-Path $SourceDir '_alwatan-common.ps1')

Write-Host ''
Write-Host '  Clinique Alwatan — mise a jour poste Pharmacie' -ForegroundColor Cyan
Write-Host '  Impression : Edge (sans agent)' -ForegroundColor Cyan
Write-Host ''

Write-Host '[1/4] Arret de l''agent d''impression...' -ForegroundColor Yellow
try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'node.exe' -and $_.CommandLine -and (
                $_.CommandLine -like '*CliniqueAlwatan*print-agent*' -or
                $_.CommandLine -like '*print-agent*server.mjs*'
            )
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }

foreach ($taskName in @('Alwatan-Print-Agent', 'AlwatanPrintAgent')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}

foreach ($folder in @(
    [Environment]::GetFolderPath('Startup'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup')
)) {
    if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { continue }
    Get-ChildItem -LiteralPath $folder -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)print-agent|alwatan.*print|AlwatanPrint' } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
}

Write-Host '[2/4] Fermeture d''Edge (profil Alwatan) + vidage du cache...' -ForegroundColor Yellow
try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.Name -match '^(msedge|chrome)\.exe$') -and $_.CommandLine -and
            ($_.CommandLine -like '*CliniqueAlwatan*app-browser*')
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }
Start-Sleep -Milliseconds 500

$profileRoot = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\app-browser'
$defaultDir = Join-Path $profileRoot 'Default'
foreach ($name in @(
    'Service Worker',
    'Cache',
    'Code Cache',
    'GPUCache'
)) {
    $p = Join-Path $defaultDir $name
    if (Test-Path -LiteralPath $p) {
        Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
    }
}
$prefsMarker = Join-Path $defaultDir '.alwatan-print-ok'
if (Test-Path -LiteralPath $prefsMarker) {
    Remove-Item -LiteralPath $prefsMarker -Force -ErrorAction SilentlyContinue
}
$revFile = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\launcher-revision.txt'
if (Test-Path -LiteralPath $revFile) {
    Remove-Item -LiteralPath $revFile -Force -ErrorAction SilentlyContinue
}

Write-Host '[3/4] Reinstallation du raccourci Bureau...' -ForegroundColor Yellow
$installer = Join-Path $SourceDir 'installer-poste-client.ps1'
if (-not (Test-Path -LiteralPath $installer)) {
    throw "Fichier manquant : $installer"
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -SourceDir $SourceDir -Quiet -SkipOpen
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "Echec installation raccourci (code $LASTEXITCODE)."
}

Write-Host '[4/4] Ouverture d''Alwatan (rechargement force, impression Edge)...' -ForegroundColor Yellow
$clientScript = Join-Path $SourceDir 'lancer-client.ps1'
if (-not (Test-Path -LiteralPath $clientScript)) {
    $clientScript = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\Alwatan Manager\lancer-client.ps1'
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $clientScript -ForceHardReload

$ok = Join-Path $SourceDir 'MAJ-PHARMACIE-OK.txt'
[System.IO.File]::WriteAllText(
    $ok,
    ("OK " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "`r`nImpression = Microsoft Edge (sans agent)`r`n"),
    $utf8Bom
)

Write-Host ''
Write-Host '  Mise a jour terminee.' -ForegroundColor Green
Write-Host '  Les tickets s''impriment avec la boite de dialogue Edge.' -ForegroundColor Green
Write-Host '  Utilisez ensuite le raccourci Bureau « Alwatan Manager ».' -ForegroundColor Green
Write-Host ''
Start-Sleep -Seconds 2
