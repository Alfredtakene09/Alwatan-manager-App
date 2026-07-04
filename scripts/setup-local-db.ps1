# Crée l'utilisateur admin, la base restaurant et applique le schéma Prisma (local uniquement).
param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresPassword,
    [string]$PgHost = "localhost",
    [int]$PgPort = 5433,
    [string]$PgSuperUser = "postgres"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
if (-not (Test-Path $Psql)) {
    $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $Psql = $found.FullName } else { throw "psql introuvable. Installez PostgreSQL ou ajoutez psql au PATH." }
}

$env:PGPASSWORD = $PostgresPassword
Write-Host "[Alwatan] Configuration base locale ${PgHost}:${PgPort}..." -ForegroundColor Cyan

$roleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin') THEN
    CREATE ROLE admin WITH LOGIN PASSWORD 'password' CREATEDB;
  ELSE
    ALTER ROLE admin WITH LOGIN PASSWORD 'password';
  END IF;
END
`$`$;
"@
& $Psql -U $PgSuperUser -h $PgHost -p $PgPort -d postgres -v ON_ERROR_STOP=1 -c $roleSql

$dbExists = & $Psql -U $PgSuperUser -h $PgHost -p $PgPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'restaurant'"
if (-not ($dbExists -match "1")) {
    & $Psql -U $PgSuperUser -h $PgHost -p $PgPort -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE restaurant OWNER admin;"
}
& $Psql -U $PgSuperUser -h $PgHost -p $PgPort -d postgres -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE restaurant TO admin;"

Push-Location "$Root\backend"
try {
    & npm.cmd run db:setup
    Write-Host "Base locale prête (admin / password / restaurant)." -ForegroundColor Green
} finally {
    Pop-Location
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
