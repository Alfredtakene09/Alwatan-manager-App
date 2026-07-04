param([int]$IntervalSeconds = 10)
$Root = Split-Path $PSScriptRoot -Parent
$LogDir = "$env:LOCALAPPDATA\alwatan-manager"
$LogFile = "$LogDir\sync-windows.log"
$GitName = if ($env:GIT_USER_NAME) { $env:GIT_USER_NAME } else { "Hassane Chogar" }
$GitEmail = if ($env:GIT_USER_EMAIL) { $env:GIT_USER_EMAIL } else { "chogarfils3@gmail.com" }

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content $LogFile $line
    Write-Host $line
}

function Git-Commit($message) {
    git -c "user.name=$GitName" -c "user.email=$GitEmail" add -A 2>&1 | Out-Null
    git -c "user.name=$GitName" -c "user.email=$GitEmail" commit -m $message 2>&1 | Out-Null
    return $LASTEXITCODE -eq 0
}

function Stop-Port($p) {
    Get-NetTCPConnection -LocalPort $p -EA SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -EA SilentlyContinue }
}

function Restart-DevServers {
    Stop-Port 4000; Stop-Port 5173; Start-Sleep 2
    Start-Process powershell -ArgumentList @("-NoExit", "-Command", "Set-Location '$Root\backend'; npm.cmd run dev")
    Start-Sleep 2
    Start-Process powershell -ArgumentList @("-NoExit", "-Command", "Set-Location '$Root\frontend'; npm.cmd run dev")
    Log "Serveurs redemarres"
}

function Apply-Deps {
    $env:Path = "C:\Program Files\nodejs;" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    Push-Location "$Root\backend"; npm.cmd install --silent 2>$null; npx.cmd prisma generate 2>$null | Out-Null; Pop-Location
    Push-Location "$Root\frontend"; npm.cmd install --silent 2>$null; Pop-Location
}

$env:Path = "C:\Program Files\nodejs;" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
Log "Auto-sync Windows actif (${IntervalSeconds}s) — commit as $GitName"
$lastHead = ""

while ($true) {
    try {
        Push-Location $Root
        git fetch origin 2>&1 | Out-Null

        if (git status --porcelain) {
            Log "Modifs locales detectees..."
            $msg = "sync: auto Windows $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            if (-not (Git-Commit $msg)) {
                Log "ERREUR: commit impossible (verifiez git user.name / user.email)"
            } else {
                git pull --rebase origin main 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    git push origin main 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) { Log "Push OK -> Mac recoit via git pull" }
                    else { Log "ERREUR push (credentials GitHub?)" }
                } else {
                    git rebase --abort 2>$null | Out-Null
                    Log "ERREUR pull/rebase (conflit avec Mac?)"
                }
            }
        }

        $local = git rev-parse HEAD
        $remote = git rev-parse origin/main
        if ($local -ne $remote) {
            Log "Nouveau code Mac detecte - pull..."
            git pull --rebase origin main 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Apply-Deps
                if ($lastHead -and $lastHead -ne (git rev-parse HEAD)) { Restart-DevServers }
                $lastHead = git rev-parse HEAD
                Log "Code Mac applique"
            } else {
                git rebase --abort 2>$null | Out-Null
                Log "ERREUR pull Mac"
            }
        }

        if (-not $lastHead) { $lastHead = git rev-parse HEAD }
        Pop-Location
    } catch {
        Log "Erreur: $($_.Exception.Message)"
        Pop-Location -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds $IntervalSeconds
}
