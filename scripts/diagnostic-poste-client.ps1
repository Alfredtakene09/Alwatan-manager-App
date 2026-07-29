# Diagnostic poste client Alwatan — ecrit un rapport a rapporter sur le serveur.
# Double-clic via DIAGNOSTIC.bat (pas besoin de copier les erreurs a la main).
param(
    [string]$ServerIp = ''
)

$ErrorActionPreference = 'Continue'
$reportLines = New-Object System.Collections.Generic.List[string]

function Add-Report([string]$Line = '') {
    $script:reportLines.Add($Line)
    Write-Host $Line
}

try {
    . "$PSScriptRoot\_alwatan-common.ps1"
} catch {
    Add-Report "ERREUR: impossible de charger _alwatan-common.ps1"
    Add-Report $_.Exception.Message
}

Add-Report '========================================'
Add-Report '  RAPPORT DIAGNOSTIC ALWATAN (CLIENT)'
Add-Report "  Date : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Report '========================================'
Add-Report ''
Add-Report "Ordinateur     : $env:COMPUTERNAME"
Add-Report "Utilisateur    : $env:USERNAME"
Add-Report "Dossier script : $PSScriptRoot"
Add-Report "Windows        : $([System.Environment]::OSVersion.VersionString)"
Add-Report "PowerShell     : $($PSVersionTable.PSVersion)"
Add-Report ''

Add-Report '--- Fichiers du pack ---'
foreach ($name in @(
    '_alwatan-common.ps1',
    'lancer-client.ps1',
    'installer-poste-client.ps1',
    'tester-poste-client.ps1',
    'alwatan-server.txt',
    'alwatan.ico',
    'INSTALLER.bat',
    'DIAGNOSTIC.bat'
)) {
    $p = Join-Path $PSScriptRoot $name
    $ok = Test-Path $p
    Add-Report ("  {0,-28} {1}" -f $name, $(if ($ok) { 'OK' } else { 'MANQUANT' }))
}
Add-Report ''

if (-not $ServerIp) {
    try { $ServerIp = Read-AlwatanServerIp } catch { $ServerIp = $null }
}
if (-not $ServerIp) {
    $cfg = Join-Path $PSScriptRoot 'alwatan-server.txt'
    if (Test-Path $cfg) {
        foreach ($line in Get-Content $cfg -ErrorAction SilentlyContinue) {
            if ($line -match '([0-9]{1,3}(?:\.[0-9]{1,3}){3})') {
                $ServerIp = $Matches[1]
                break
            }
        }
    }
}
if (-not $ServerIp) { $ServerIp = '192.168.88.161' }

Add-Report "IP serveur cible : $ServerIp"
try {
    $localIp = Get-LocalLanIpv4
} catch {
    $localIp = $null
}
Add-Report ("IP de ce poste  : {0}" -f $(if ($localIp) { $localIp } else { '(introuvable)' }))
if ($localIp) {
    $serverPrefix = ($ServerIp -split '\.')[0..2] -join '.'
    $localPrefix = ($localIp -split '\.')[0..2] -join '.'
    if ($serverPrefix -ne $localPrefix) {
        Add-Report "ATTENTION : sous-reseau different ($localPrefix vs $serverPrefix)"
    }
}
Add-Report ''

Add-Report '--- Ping ---'
try {
    $ping = Test-Connection -ComputerName $ServerIp -Count 2 -Quiet -ErrorAction SilentlyContinue
    Add-Report ("  ping {0} : {1}" -f $ServerIp, $(if ($ping) { 'OK' } else { 'ECHEC (souvent normal si ICMP bloque)' }))
} catch {
    Add-Report ("  ping erreur : {0}" -f $_.Exception.Message)
}
Add-Report ''

Add-Report '--- Ports TCP ---'
$port4000Ok = $false
$port445Ok = $false
foreach ($port in @(4000, 5173, 445)) {
    try {
        $t = Test-NetConnection -ComputerName $ServerIp -Port $port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
        $ok = [bool]$t.TcpTestSucceeded
        if ($port -eq 4000) { $port4000Ok = $ok }
        if ($port -eq 445) { $port445Ok = $ok }
        Add-Report ("  TCP {0}:{1} : {2}" -f $ServerIp, $port, $(if ($ok) { 'OK' } else { 'ECHEC' }))
    } catch {
        Add-Report ("  TCP {0}:{1} : ERREUR ({2})" -f $ServerIp, $port, $_.Exception.Message)
    }
}
Add-Report ''

Add-Report '--- HTTP application ---'
try {
    $httpOk = Test-AlwatanProductionApp -HostName $ServerIp -Port 4000 -TimeoutSec 5
    Add-Report ("  http://{0}:4000/ : {1}" -f $ServerIp, $(if ($httpOk) { 'OK' } else { 'ECHEC' }))
} catch {
    Add-Report ("  HTTP erreur : {0}" -f $_.Exception.Message)
    $httpOk = $false
}
Add-Report ''

Add-Report '--- Navigateurs ---'
$browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
)
$foundBrowser = $false
foreach ($b in $browsers) {
    if (Test-Path $b) {
        Add-Report "  OK : $b"
        $foundBrowser = $true
    }
}
if (-not $foundBrowser) {
    Add-Report '  AUCUN navigateur Edge/Chrome trouve'
}
Add-Report ''

Add-Report '--- Installation locale (si deja faite) ---'
$installDir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\Alwatan Manager'
Add-Report ("  Dossier install : {0} ({1})" -f $installDir, $(if (Test-Path $installDir) { 'present' } else { 'absent' }))
$desk = [Environment]::GetFolderPath('Desktop')
$deskLnk = Join-Path $desk 'Alwatan Manager.lnk'
Add-Report ("  Raccourci Bureau : {0}" -f $(if (Test-Path $deskLnk) { 'present' } else { 'absent' }))
Add-Report ''

Add-Report '--- Conclusion ---'
if ($port4000Ok -or $httpOk) {
    Add-Report 'SUCCES : le serveur Alwatan est joignable depuis ce PC.'
    Add-Report "Ouvrir : http://${ServerIp}:4000/"
    Add-Report 'Si le navigateur ne s''ouvre pas : lancez INSTALLER.bat puis le raccourci Bureau.'
} elseif ($port445Ok) {
    Add-Report 'RESEAU OK mais port 4000 ferme.'
    Add-Report 'Sur le SERVEUR : allumer Alwatan, puis scripts\forcer-acces-lan.cmd (admin).'
} else {
    Add-Report 'ECHEC RESEAU : isolation Wi-Fi, mauvais VLAN, ou mauvaise IP.'
    Add-Report 'Verifiez que ce PC et le serveur sont sur le meme reseau / meme Wi-Fi.'
}
Add-Report ''
Add-Report 'Copiez ce fichier sur une cle USB et ouvrez-le sur le serveur pour analyse.'
Add-Report '========================================'

$reportText = ($reportLines -join [Environment]::NewLine)
$reportName = 'RAPPORT-ALWATAN-CLIENT.txt'
$targets = @(
    (Join-Path $PSScriptRoot $reportName),
    (Join-Path $desk $reportName)
)
foreach ($target in $targets) {
    try {
        Set-Content -Path $target -Value $reportText -Encoding UTF8
        Write-Host ''
        Write-Host "Rapport enregistre : $target" -ForegroundColor Green
    } catch {
        Write-Host "Impossible d'ecrire $target : $($_.Exception.Message)" -ForegroundColor Red
    }
}

$primary = Join-Path $PSScriptRoot $reportName
if (Test-Path $primary) {
    Start-Process notepad.exe $primary
}

Write-Host ''
try {
    Write-Host 'Appuyez sur Entree pour fermer...' -ForegroundColor Cyan
    [void][Console]::ReadLine()
} catch {
    Start-Sleep -Seconds 3
}
exit $(if ($port4000Ok -or $httpOk) { 0 } else { 1 })
