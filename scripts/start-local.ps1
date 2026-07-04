# Démarrage local — PostgreSQL sur cette machine (pas de réseau, pas de Docker)
$ErrorActionPreference = "Continue"
function Q { param([scriptblock]$B) try { & $B 2>$null | Out-Null } catch {} }

$Root = Split-Path $PSScriptRoot -Parent
$NodeDir = "C:\Program Files\nodejs"
$env:Path = "$NodeDir;" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

Write-Host "[Alwatan] Démarrage local (PostgreSQL localhost:5433)" -ForegroundColor Cyan

if (-not (Test-Path "$Root\backend\.env")) {
    Copy-Item "$Root\backend\.env.example" "$Root\backend\.env"
    Write-Host "backend/.env créé depuis .env.example"
}

$t = Test-NetConnection -ComputerName localhost -Port 5433 -WarningAction SilentlyContinue
if (-not $t.TcpTestSucceeded) {
    Write-Host "ATTENTION: PostgreSQL inaccessible sur localhost:5433. Vérifiez que le service tourne." -ForegroundColor Yellow
}

Write-Host "[1/3] Backend..."
Push-Location "$Root\backend"
& "$NodeDir\npm.cmd" install --silent 2>$null
& "$NodeDir\npx.cmd" prisma generate 2>$null
Get-NetTCPConnection -LocalPort 4000 -EA SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -EA SilentlyContinue }
Pop-Location

Write-Host "[2/3] Frontend..."
Push-Location "$Root\frontend"
& "$NodeDir\npm.cmd" install --silent 2>$null
Get-NetTCPConnection -LocalPort 5173 -EA SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -EA SilentlyContinue }
Pop-Location

Write-Host "[3/3] Démarrage des serveurs..."
$be = "$Root\backend"
$fe = "$Root\frontend"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", "`$env:Path='$NodeDir;'+`$env:Path; Set-Location '$be'; npm.cmd run dev")
Start-Sleep 3
Start-Process powershell -ArgumentList @("-NoExit", "-Command", "`$env:Path='$NodeDir;'+`$env:Path; Set-Location '$fe'; npm.cmd run dev")

Write-Host ""
Write-Host "Prêt:" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:5173"
Write-Host "  API      : http://localhost:4000"
Write-Host "  Base     : localhost:5433/restaurant"
