# Met a jour les fichiers AppData depuis le package print-agent, puis demarre l'agent.
# A lancer depuis acces-client ou print-agent (sur le poste Pharmacie / Reception).
param(
    [string]$PrinterName = 'POS-80',
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Find-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    foreach ($dir in @(
        'C:\Program Files\nodejs',
        'C:\Program Files (x86)\nodejs',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')
    )) {
        $exe = Join-Path $dir 'node.exe'
        if (Test-Path $exe) { return $exe }
    }
    return $null
}

$scriptsDir = $PSScriptRoot
$src = Split-Path $scriptsDir -Parent
if (-not (Test-Path (Join-Path $src 'server.mjs'))) {
    throw "Sources print-agent introuvables: $src"
}

$nodeExe = Find-NodeExe
if (-not $nodeExe) { throw 'Node.js introuvable' }

$installDir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\print-agent'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installDir 'logs') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installDir 'lib') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installDir 'scripts') -Force | Out-Null

Write-Host ''
Write-Host 'Mise a jour AppData print-agent...' -ForegroundColor Cyan
Write-Host ("Source : {0}" -f $src)
Write-Host ("Cible  : {0}" -f $installDir)

# Garder l'ancienne config si presente
$configPath = Join-Path $installDir 'config.json'
$oldPrinter = $null
if (Test-Path $configPath) {
    try {
        $old = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($old.printerName) { $oldPrinter = [string]$old.printerName }
    } catch { }
}

Copy-Item (Join-Path $src 'server.mjs') $installDir -Force
Copy-Item (Join-Path $src 'package.json') $installDir -Force
Copy-Item (Join-Path $src 'config.example.json') $installDir -Force
Copy-Item (Join-Path $src 'lib\*') (Join-Path $installDir 'lib') -Force
Copy-Item (Join-Path $src 'scripts\*') (Join-Path $installDir 'scripts') -Force

if (-not $oldPrinter) { $oldPrinter = $PrinterName }
# Preferer Generic/Text RAW (imprime vraiment ESC/POS) puis POS-80
$winRaw = Get-Printer -Name 'Alwatan-Ticket-RAW' -ErrorAction SilentlyContinue
$winPos = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)^POS-80$' } | Select-Object -First 1
if ($winRaw) { $oldPrinter = $winRaw.Name }
elseif ($winPos) { $oldPrinter = $winPos.Name }

$cfgObj = [pscustomobject]@{
    port = 19100
    host = '127.0.0.1'
    interface = 'usb'
    printerName = $oldPrinter
    paperWidthChars = 48
    cut = $true
    openCashDrawer = $false
    codePage = 'cp850'
    logDir = 'logs'
}
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($configPath, ($cfgObj | ConvertTo-Json), $utf8NoBom)
Write-Host ("Config printerName={0}" -f $oldPrinter) -ForegroundColor Green

# Scripts de demarrage
$startScript = Join-Path $installDir 'start-agent.cmd'
@(
    '@echo off',
    'title Alwatan Print Agent',
    ('cd /d "{0}"' -f $installDir),
    ('"{0}" server.mjs >> "logs\agent-out.log" 2>> "logs\agent-err.log"' -f $nodeExe)
) | ForEach-Object { $_ } | Set-Content -Path $startScript -Encoding ASCII

$relancer = Join-Path $installDir 'RELANCER-AGENT.bat'
@(
    '@echo off',
    'title Relancer Alwatan Print Agent',
    ('cd /d "{0}"' -f $installDir),
    'echo Arret...',
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.Name -eq ''node.exe'' -and $_.CommandLine -like ''*CliniqueAlwatan\print-agent*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }"',
    'timeout /t 1 /nobreak >nul',
    ('start "AlwatanPrintAgent" /D "{0}" /MIN cmd /c """{1}"" server.mjs >> logs\agent-out.log 2>> logs\agent-err.log"' -f $installDir, $nodeExe),
    'timeout /t 3 /nobreak >nul',
    'powershell -NoProfile -Command "try { $h=Invoke-RestMethod http://127.0.0.1:19100/health -TimeoutSec 4; Write-Host (''OK printer='' + $h.printerName) -ForegroundColor Green } catch { Write-Host ''ECHEC'' -ForegroundColor Red; Get-Content logs\agent-err.log -Tail 20 -EA SilentlyContinue; pause }"',
    'pause'
) | Set-Content -Path $relancer -Encoding ASCII

# Tache planifiee au login (plus fiable que le dossier Demarrage)
$taskName = 'Alwatan-Print-Agent'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $nodeExe -Argument 'server.mjs' -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT10S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Agent impression ESC/POS Alwatan (USB local 127.0.0.1:19100)' -Force | Out-Null
Write-Host ("Tache planifiee: {0}" -f $taskName) -ForegroundColor Green

# Arreter ancien + demarrer
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -and ($_.CommandLine -like '*CliniqueAlwatan\print-agent*')
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 600

Start-Process -FilePath $nodeExe -ArgumentList 'server.mjs' -WorkingDirectory $installDir -WindowStyle Hidden
Start-Sleep -Seconds 3

$ok = $false
try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:19100/health' -TimeoutSec 4
    if ($h.ok) {
        $ok = $true
        Write-Host ("[OK] Agent demarre - printer={0}" -f $h.printerName) -ForegroundColor Green
    }
} catch {
    Write-Host '[X] Agent non joignable' -ForegroundColor Red
    $errLog = Join-Path $installDir 'logs\agent-err.log'
    if (Test-Path $errLog) { Get-Content $errLog -Tail 20 }
}

Write-Host ''
Write-Host 'IMPORTANT navigateur Alwatan (page sur 192.168.x.x) :' -ForegroundColor Yellow
Write-Host '  Chrome/Edge doit AUTORISER Acces au reseau local / Local network' -ForegroundColor Yellow
Write-Host '  pour pouvoir parler a 127.0.0.1:19100 (imprimante USB).' -ForegroundColor Yellow
Write-Host '  Parametres site du serveur Alwatan -> Acces reseau local -> Autoriser' -ForegroundColor Yellow
Write-Host ''

if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    $msg = if ($ok) {
        "AppData mis a jour et agent demarre.`nImprimante: $oldPrinter`n`nDans Chrome: autorisez Acces reseau local pour http://192.168.1.175:4000 puis F5."
    } else {
        "Mise a jour faite mais agent non demarre.`nLancez: $relancer"
    }
    [System.Windows.MessageBox]::Show($msg, 'Alwatan Print Agent') | Out-Null
}

if (-not $ok) { exit 1 }
