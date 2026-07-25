# Construit l'application et installe le service Windows (redémarrage auto).
# Prérequis : Node.js, PostgreSQL, PowerShell Administrateur.
# Optionnel : NSSM (https://nssm.cc) — sinon une tâche planifiée au démarrage est utilisée.

#Requires -RunAsAdministrator

param(
    [switch]$SkipBuild,
    [switch]$SkipFirewall,
    [switch]$SkipBackupTask,
    [int]$Port = 4000,
    [string]$ServiceName = 'AlwatanManager'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$envFile = Ensure-AlwatanEnvFile -Root $Root
$lanIp = Get-LocalLanIpv4
$be = Join-Path $Root 'backend'
$fe = Join-Path $Root 'frontend'
$runtimeDir = Join-Path $Root 'runtime'
$logsDir = Join-Path $runtimeDir 'logs'
$nssmDir = Join-Path $runtimeDir 'nssm'
$wrapperPs1 = Join-Path $runtimeDir 'start-production.ps1'
$wrapperCmd = Join-Path $runtimeDir 'start-production.cmd'

New-Item -ItemType Directory -Force -Path $runtimeDir, $logsDir, $nssmDir | Out-Null

Write-Host ''
Write-Host '  Clinique Alwatan — Installation production' -ForegroundColor Cyan
Write-Host "  Racine : $Root"
Write-Host ''

# --- CORS large pour le LAN ---
$corsOrigins = @(
    "http://localhost:$Port",
    "http://127.0.0.1:$Port",
    'http://localhost:5173',
    'http://127.0.0.1:5173'
)
if ($lanIp) {
    $corsOrigins += "http://${lanIp}:$Port"
    $corsOrigins += "http://${lanIp}:5173"
}
$corsValue = ($corsOrigins | Select-Object -Unique) -join ','

$envLines = @()
if (Test-Path $envFile) {
    $envLines = Get-Content $envFile
}
$envMap = @{}
foreach ($line in $envLines) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $key, $val = $line.Split('=', 2)
    $envMap[$key.Trim()] = $val.Trim().Trim('"')
}
$envMap['PORT'] = "$Port"
$envMap['HOST'] = '0.0.0.0'
$envMap['CORS_ORIGIN'] = $corsValue
$envMap['SERVE_FRONTEND'] = '1'
$envMap['FRONTEND_DIST'] = (Join-Path $fe 'dist')
if (-not $envMap.ContainsKey('JWT_SECRET') -or $envMap['JWT_SECRET'] -match 'changez-ce-secret') {
    $envMap['JWT_SECRET'] = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    Write-Host 'JWT_SECRET généré automatiquement.' -ForegroundColor Yellow
}

$newEnv = foreach ($key in @('DATABASE_URL', 'JWT_SECRET', 'PORT', 'HOST', 'CORS_ORIGIN', 'SERVE_FRONTEND', 'FRONTEND_DIST')) {
    if ($envMap.ContainsKey($key)) {
        "${key}=`"$($envMap[$key])`""
    }
}
foreach ($key in $envMap.Keys) {
    if ($key -notin @('DATABASE_URL', 'JWT_SECRET', 'PORT', 'HOST', 'CORS_ORIGIN', 'SERVE_FRONTEND', 'FRONTEND_DIST')) {
        $newEnv += "${key}=`"$($envMap[$key])`""
    }
}
Set-Content -Path $envFile -Value $newEnv -Encoding UTF8
Write-Host "Fichier .env mis à jour (PORT=$Port, HOST=0.0.0.0, SERVE_FRONTEND=1)" -ForegroundColor Green

# --- Build ---
if (-not $SkipBuild) {
    Write-Host '[1/5] Installation dépendances + build...' -ForegroundColor Cyan
    Push-Location $be
    & "$nodeDir\npm.cmd" install
    & "$nodeDir\npx.cmd" prisma generate
    & "$nodeDir\npm.cmd" run build
    Pop-Location

    Push-Location $fe
    & "$nodeDir\npm.cmd" install
    & "$nodeDir\npm.cmd" run build
    Pop-Location

    if (-not (Test-Path (Join-Path $fe 'dist\index.html'))) {
        throw 'Build frontend échoué : frontend\dist\index.html introuvable.'
    }
    if (-not (Test-Path (Join-Path $be 'dist\index.js'))) {
        throw 'Build backend échoué : backend\dist\index.js introuvable.'
    }
} else {
    Write-Host '[1/5] Build ignoré (-SkipBuild).' -ForegroundColor Yellow
}

# --- Wrapper de démarrage ---
$distJs = Join-Path $be 'dist\index.js'
$frontDist = Join-Path $fe 'dist'
$wrapperLines = @(
    '$ErrorActionPreference = ''Stop'''
    "`$env:Path = '$nodeDir;' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')"
    "Set-Location '$be'"
    "`$env:PORT = '$Port'"
    "`$env:HOST = '0.0.0.0'"
    "`$env:SERVE_FRONTEND = '1'"
    "`$env:FRONTEND_DIST = '$frontDist'"
    "if (Test-Path '$envFile') {"
    "    Get-Content '$envFile' | ForEach-Object {"
    "        if (`$_ -match '^\s*#' -or `$_ -notmatch '=') { return }"
    "        `$k, `$v = `$_.Split('=', 2)"
    "        Set-Item -Path ('Env:' + `$k.Trim()) -Value (`$v.Trim().Trim('\"'))"
    "    }"
    "}"
    "& '$nodeDir\node.exe' '$distJs'"
)
Set-Content -Path $wrapperPs1 -Value $wrapperLines -Encoding UTF8

@(
    '@echo off'
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$wrapperPs1`""
) | Set-Content -Path $wrapperCmd -Encoding ASCII
Write-Host "[2/5] Wrapper créé : $wrapperCmd" -ForegroundColor Green

function Find-Nssm {
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $local = Join-Path $nssmDir 'nssm.exe'
    if (Test-Path $local) { return $local }
    return $null
}

function Install-NssmIfPossible {
    $existing = Find-Nssm
    if ($existing) { return $existing }

    Write-Host 'NSSM introuvable — tentative de téléchargement...' -ForegroundColor Yellow
    $zip = Join-Path $nssmDir 'nssm.zip'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $nssmDir -Force
        $exe = Get-ChildItem -Path $nssmDir -Recurse -Filter 'nssm.exe' |
            Where-Object { $_.FullName -match '\\win64\\nssm\.exe$' } |
            Select-Object -First 1
        if (-not $exe) {
            $exe = Get-ChildItem -Path $nssmDir -Recurse -Filter 'nssm.exe' | Select-Object -First 1
        }
        if ($exe) {
            Copy-Item $exe.FullName (Join-Path $nssmDir 'nssm.exe') -Force
            return (Join-Path $nssmDir 'nssm.exe')
        }
    } catch {
        Write-Host "Téléchargement NSSM impossible : $($_.Exception.Message)" -ForegroundColor Yellow
    }
    return $null
}

# --- Arrêter / désinstaller service ou tâche existante ---
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Arrêt du service existant $ServiceName..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Unregister-ScheduledTask -TaskName 'Alwatan-Demarrage-Production' -Confirm:$false -ErrorAction SilentlyContinue

# --- Installer via NSSM ou tâche planifiée ---
Write-Host '[3/5] Installation du démarrage automatique...' -ForegroundColor Cyan
$nssm = Install-NssmIfPossible
$mode = 'task'

if ($nssm) {
    Write-Host "NSSM : $nssm" -ForegroundColor Green
    & $nssm stop $ServiceName 2>$null | Out-Null
    & $nssm remove $ServiceName confirm 2>$null | Out-Null

    & $nssm install $ServiceName $wrapperCmd
    & $nssm set $ServiceName AppDirectory $be
    & $nssm set $ServiceName DisplayName 'Alwatan Manager (Clinique)'
    & $nssm set $ServiceName Description 'API + interface Alwatan Manager — redémarrage automatique'
    & $nssm set $ServiceName Start SERVICE_AUTO_START
    & $nssm set $ServiceName AppStdout (Join-Path $logsDir 'service-out.log')
    & $nssm set $ServiceName AppStderr (Join-Path $logsDir 'service-err.log')
    & $nssm set $ServiceName AppRotateFiles 1
    & $nssm set $ServiceName AppRotateBytes 2097152
    & $nssm set $ServiceName AppExit Default Restart
    & $nssm set $ServiceName AppRestartDelay 5000

    Start-Service -Name $ServiceName
    $mode = 'nssm'
    Write-Host "Service Windows installé et démarré : $ServiceName" -ForegroundColor Green
} else {
    Write-Host 'Fallback : tâche planifiée au démarrage Windows.' -ForegroundColor Yellow
    $action = New-ScheduledTaskAction -Execute $wrapperCmd
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask `
        -TaskName 'Alwatan-Demarrage-Production' `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -User 'SYSTEM' `
        -RunLevel Highest `
        -Force | Out-Null

    Start-Process -FilePath $wrapperCmd -WindowStyle Hidden
    Write-Host 'Tâche « Alwatan-Demarrage-Production » créée et processus démarré.' -ForegroundColor Green
}

# --- Pare-feu ---
if (-not $SkipFirewall) {
    Write-Host '[4/5] Pare-feu...' -ForegroundColor Cyan
    & "$PSScriptRoot\ouvrir-parefeu.ps1" -Port $Port
} else {
    Write-Host '[4/5] Pare-feu ignoré.' -ForegroundColor Yellow
}

# --- Sauvegarde planifiée ---
if (-not $SkipBackupTask) {
    Write-Host '[5/5] Sauvegarde nocturne...' -ForegroundColor Cyan
    & "$PSScriptRoot\installer-sauvegarde-planifiee.ps1" -Time '02:00' -KeepDays 30
} else {
    Write-Host '[5/5] Sauvegarde planifiée ignorée.' -ForegroundColor Yellow
}

# --- IP serveur pour clients ---
if ($lanIp) {
    $cfg = @"
# Adresse IP du poste serveur Alwatan (production)
SERVER_IP=$lanIp
"@
    Set-Content -Path (Join-Path $PSScriptRoot '..\alwatan-server.txt') -Value $cfg -Encoding UTF8
}

Write-Host ''
Write-Host 'Installation terminée.' -ForegroundColor Green
Write-Host "Mode démarrage auto : $mode"
Write-Host "Sur ce poste     : http://127.0.0.1:$Port"
if ($lanIp) {
    Write-Host "Sur le réseau    : http://${lanIp}:$Port"
    Write-Host "Fichier clients  : scripts\alwatan-server.txt → SERVER_IP=$lanIp"
}
Write-Host "Logs             : $logsDir"
Write-Host "Sauvegardes      : $(Join-Path $Root 'backups\postgres')"
Write-Host ''
Write-Host 'Vérifiez que PostgreSQL est en démarrage automatique (services.msc).' -ForegroundColor DarkGray
Write-Host 'Branchez le serveur sur un onduleur (UPS) pour les coupures de courant.' -ForegroundColor DarkGray
Write-Host ''
