# Sauvegarde PostgreSQL (pg_dump) — Alwatan Manager
# Usage : .\sauvegarder-base.ps1
#         .\sauvegarder-base.ps1 -KeepDays 14

param(
    [int]$KeepDays = 30,
    [string]$BackupRoot = ''
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$envFile = Ensure-AlwatanEnvFile -Root $Root

if (-not $BackupRoot) {
    $BackupRoot = Join-Path $Root 'backups\postgres'
}
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

function Read-DatabaseUrl {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^DATABASE_URL\s*=\s*"?([^"#]+)"?') {
            return $Matches[1].Trim()
        }
    }
    return $null
}

function Find-PgDump {
    $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $roots = @(
        'C:\Program Files\PostgreSQL',
        'C:\Program Files (x86)\PostgreSQL'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $found = Get-ChildItem -Path $root -Recurse -Filter 'pg_dump.exe' -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Write-BackupFailure {
    param([string]$Message)
    $logDir = Join-Path $Root 'runtime\logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $logFile = Join-Path $logDir 'backup-failures.log'
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host "Échec sauvegarde consigné → $logFile" -ForegroundColor Red
    $source = 'Alwatan Manager'
    try {
        Write-EventLog -LogName Application -Source $source -EventId 4001 -EntryType Error -Message $line -ErrorAction Stop
    } catch {
        try {
            New-EventLog -LogName Application -Source $source -ErrorAction SilentlyContinue
            Write-EventLog -LogName Application -Source $source -EventId 4001 -EntryType Error -Message $line -ErrorAction SilentlyContinue
        } catch {
            # Pas de droits Event Log : le fichier runtime/logs/backup-failures.log suffit.
        }
    }
}

try {

$dbUrl = Read-DatabaseUrl -Path $envFile
if (-not $dbUrl) {
    throw "DATABASE_URL introuvable dans $envFile"
}

# postgresql://user:pass@host:port/db?schema=public
if ($dbUrl -notmatch '^postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)') {
    throw "Impossible d'analyser DATABASE_URL. Format attendu : postgresql://user:pass@host:port/db"
}

$user = $Matches[1]
$pass = [uri]::UnescapeDataString($Matches[2])
$hostName = $Matches[3]
$port = $Matches[4]
$dbName = $Matches[5]

$pgDump = Find-PgDump
if (-not $pgDump) {
    throw "pg_dump.exe introuvable. Installez les outils client PostgreSQL ou ajoutez-les au PATH."
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path $BackupRoot "alwatan-$stamp.sql"
$env:PGPASSWORD = $pass

Write-Host "Sauvegarde en cours → $outFile"
& $pgDump -h $hostName -p $port -U $user -d $dbName -F p --no-owner --no-acl -f $outFile
if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    throw "pg_dump a échoué (code $LASTEXITCODE)."
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

$sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host "OK — $sizeMb Mo" -ForegroundColor Green

$cutoff = (Get-Date).AddDays(-1 * [math]::Abs($KeepDays))

$uploadsRoot = Join-Path $Root 'backend\uploads'
$uploadsBackupRoot = Join-Path (Split-Path $BackupRoot -Parent) 'uploads'
if (Test-Path $uploadsRoot) {
    New-Item -ItemType Directory -Force -Path $uploadsBackupRoot | Out-Null
    $uploadsZip = Join-Path $uploadsBackupRoot "uploads-$stamp.zip"
    Write-Host "Sauvegarde des pièces jointes → $uploadsZip"
    if (Get-Command Compress-Archive -ErrorAction SilentlyContinue) {
        Compress-Archive -Path (Join-Path $uploadsRoot '*') -DestinationPath $uploadsZip -Force
        Write-Host "OK — pièces jointes archivées" -ForegroundColor Green
    } else {
        Write-Warning "Compress-Archive indisponible — copies manuelles de backend\\uploads recommandées."
    }
    Get-ChildItem -Path $uploadsBackupRoot -Filter 'uploads-*.zip' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object {
            Write-Host "Suppression ancienne archive uploads : $($_.Name)" -ForegroundColor DarkGray
            Remove-Item $_.FullName -Force
        }
} else {
    Write-Host "Aucun dossier backend\\uploads à archiver." -ForegroundColor DarkGray
}

Get-ChildItem -Path $BackupRoot -Filter 'alwatan-*.sql' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Write-Host "Suppression ancienne sauvegarde : $($_.Name)" -ForegroundColor DarkGray
        Remove-Item $_.FullName -Force
    }

    Write-Output $outFile
} catch {
    Write-BackupFailure $_.Exception.Message
    throw
}
