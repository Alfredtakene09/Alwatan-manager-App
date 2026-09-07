# Install Alwatan ESC/POS print agent on this PC (Reception / Pharmacie).
param(
    [string]$PrinterName = '',
    [string]$SourceDir = '',
    [switch]$Quiet,
    [switch]$Auto
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

$agentSrc = $null
$candidates = @(
    (Split-Path $PSScriptRoot -Parent),
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'print-agent'),
    (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'print-agent'),
    $PSScriptRoot
)
if ($SourceDir) {
    $candidates = @(
        $SourceDir,
        (Join-Path $SourceDir 'print-agent'),
        (Join-Path $SourceDir 'acces-client\print-agent')
    ) + $candidates
}
foreach ($c in $candidates) {
    if ($c -and (Test-Path (Join-Path $c 'server.mjs'))) {
        $agentSrc = $c
        break
    }
}
if (-not $agentSrc) {
    throw "Dossier print-agent introuvable (server.mjs manquant). Copiez le dossier COMPLET print-agent (server.mjs, lib, scripts). Cherche: $PSScriptRoot"
}

Write-Host "Sources agent : $agentSrc" -ForegroundColor DarkGray

$nodeExe = Find-NodeExe
if (-not $nodeExe) {
    throw "Node.js introuvable. Installez Node LTS, FERMEZ puis ROUVREZ cette fenetre, puis relancez."
}

Write-Host "Node detecte : $nodeExe" -ForegroundColor Green
$nodeDir = Split-Path $nodeExe -Parent
$env:Path = "$nodeDir;" + $env:Path

$installDir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\print-agent'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installDir 'logs') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installDir 'lib') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installDir 'scripts') -Force | Out-Null

Copy-Item (Join-Path $agentSrc 'server.mjs') $installDir -Force
Copy-Item (Join-Path $agentSrc 'package.json') $installDir -Force
Copy-Item (Join-Path $agentSrc 'config.example.json') $installDir -Force
Copy-Item (Join-Path $agentSrc 'lib\*') (Join-Path $installDir 'lib') -Force
Copy-Item (Join-Path $agentSrc 'scripts\*') (Join-Path $installDir 'scripts') -Force

$configPath = Join-Path $installDir 'config.json'
if (-not (Test-Path $configPath)) {
    Copy-Item (Join-Path $installDir 'config.example.json') $configPath -Force
}

$printers = @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $_.Name })
Write-Host ''
Write-Host 'Imprimantes Windows detectees :' -ForegroundColor Cyan
if ($printers.Count -eq 0) {
    Write-Host '  (aucune)' -ForegroundColor Yellow
} else {
    $printers | ForEach-Object { Write-Host ("  - {0}" -f $_) }
}

if (-not $PrinterName) {
    $prefer = $printers | Where-Object { $_ -match '(?i)pos-?80|eco250|e-?pos|syntalsol|thermal|ticket|receipt|generic.?text' } | Select-Object -First 1
    if ($Auto -and $prefer) {
        $PrinterName = $prefer
        Write-Host ("Auto : imprimante choisie = {0}" -f $PrinterName) -ForegroundColor Green
    } elseif ($Auto -and $printers.Count -eq 1) {
        $PrinterName = $printers[0]
        Write-Host ("Auto : seule imprimante = {0}" -f $PrinterName) -ForegroundColor Green
    } else {
        Write-Host ''
        $PrinterName = Read-Host 'Nom exact de limprimante E-PoS ECO250 (copier-coller)'
    }
}
$PrinterName = $PrinterName.Trim()
if (-not $PrinterName) {
    throw 'Nom dimprimante obligatoire.'
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$config.printerName = $PrinterName
$config.interface = 'usb'
$config.host = '127.0.0.1'
$config.port = 19100
# UTF-8 sans BOM (sinon node JSON.parse peut planter au demarrage)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8NoBom)

$logsDir = Join-Path $installDir 'logs'
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$startScript = Join-Path $installDir 'start-agent.cmd'
$cmdLines = @(
    '@echo off',
    'title Alwatan Print Agent',
    ('cd /d "{0}"' -f $installDir),
    ('"{0}" server.mjs >> "logs\agent-out.log" 2>> "logs\agent-err.log"' -f $nodeExe),
    'echo.',
    'echo Agent arrete. Voir logs\agent-err.log',
    'pause'
)
[System.IO.File]::WriteAllLines($startScript, $cmdLines)

$vbs = Join-Path $installDir 'start-agent-hidden.vbs'
# Ne pas doubler les antislash (casse les chemins avec espaces type Pharmacie Alwatan)
$vbsLines = @(
    'Set sh = CreateObject("WScript.Shell")',
    ('sh.CurrentDirectory = "{0}"' -f $installDir),
    ('sh.Run "cmd /c """"{0}"" server.mjs >> logs\agent-out.log 2>> logs\agent-err.log""", 0, False' -f $nodeExe)
)
[System.IO.File]::WriteAllLines($vbs, $vbsLines)

$relancerBat = Join-Path $installDir 'RELANCER-AGENT.bat'
$relancerLines = @(
    '@echo off',
    'title Relancer Alwatan Print Agent',
    ('cd /d "{0}"' -f $installDir),
    'echo Arret ancien agent...',
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.Name -eq ''node.exe'' -and $_.CommandLine -like ''*CliniqueAlwatan\print-agent*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }"',
    'timeout /t 1 /nobreak >nul',
    'echo Demarrage agent local 127.0.0.1:19100 ...',
    ('start "AlwatanPrintAgent" /D "{0}" /MIN cmd /c """{1}"" server.mjs >> logs\agent-out.log 2>> logs\agent-err.log"' -f $installDir, $nodeExe),
    'timeout /t 3 /nobreak >nul',
    'powershell -NoProfile -Command "try { $h=Invoke-RestMethod http://127.0.0.1:19100/health -TimeoutSec 4; Write-Host (''OK agent local - printer='' + $h.printerName) -ForegroundColor Green } catch { Write-Host ''ECHEC: ouvrez logs\agent-err.log'' -ForegroundColor Red; if (Test-Path ''logs\agent-err.log'') { Get-Content ''logs\agent-err.log'' -Tail 20 }; pause }"',
    'echo.',
    'echo NOTE: 127.0.0.1 = CE poste (imprimante USB). 192.168.1.175 = serveur Alwatan (app web).',
    'echo.',
    'pause'
)
[System.IO.File]::WriteAllLines($relancerBat, $relancerLines)

$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Alwatan Print Agent.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = ('"{0}"' -f $vbs)
$lnk.WorkingDirectory = $installDir
$lnk.WindowStyle = 7
$lnk.Description = 'Agent impression ESC/POS Alwatan USB'
$lnk.Save()

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -and (
            $_.CommandLine -like '*print-agent*server.mjs*' -or
            $_.CommandLine -like '*CliniqueAlwatan\print-agent*'
        )
    } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Milliseconds 500

Write-Host 'Demarrage de l agent local (127.0.0.1:19100)...' -ForegroundColor Cyan
$outLog = Join-Path $logsDir 'agent-out.log'
$errLog = Join-Path $logsDir 'agent-err.log'
# Demarrer via cmd pour chemins avec espaces (Pharmacie Alwatan)
$launchCmd = '"{0}" server.mjs' -f $nodeExe
$proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList @('/c', $launchCmd) `
    -WorkingDirectory $installDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru
Start-Sleep -Seconds 4

$healthOk = $false
$printerOk = $null
for ($i = 0; $i -lt 6; $i++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:19100/health' -TimeoutSec 3
        if ($health.ok) {
            $healthOk = $true
            $printerOk = $health.printerName
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if ($healthOk) {
    Write-Host ''
    Write-Host ("Agent OK - imprimante: {0} (PID {1})" -f $printerOk, $proc.Id) -ForegroundColor Green
    Write-Host 'NB: 127.0.0.1:19100 = agent SUR CE PC (USB). 192.168.x.x:4000 = serveur web Alwatan.' -ForegroundColor DarkGray
} else {
    Write-Host ''
    Write-Host 'Installation terminee, mais agent non joignable encore.' -ForegroundColor Yellow
    Write-Host ("Double-cliquez : {0}" -f $relancerBat) -ForegroundColor Yellow
    Write-Host ("Ou : {0}" -f $startScript) -ForegroundColor Yellow
    if (Test-Path $errLog) {
        Write-Host '--- Dernieres lignes logs\agent-err.log ---' -ForegroundColor Yellow
        Get-Content $errLog -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
}

if ($healthOk) {
    try {
        $null = Invoke-RestMethod -Uri 'http://127.0.0.1:19100/test' -Method Post -TimeoutSec 10
        Write-Host 'Ticket TEST envoye a limprimante.' -ForegroundColor Green
    } catch {
        Write-Host ("Agent OK mais test impression echoue : {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        Write-Host 'Verifiez USB allumee et nom Windows exact (ex. POS-80).' -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host ("Installe dans : {0}" -f $installDir) -ForegroundColor Cyan
Write-Host ("Config       : {0}" -f $configPath) -ForegroundColor Cyan
Write-Host ("Demarrage auto : {0}" -f $lnkPath) -ForegroundColor Cyan
Write-Host ("Relancer     : {0}" -f $relancerBat) -ForegroundColor Cyan
Write-Host ''
Write-Host 'IMPORTANT Chrome/Edge :' -ForegroundColor Yellow
Write-Host '  Si demande Acces reseau local / Local network -> Autoriser.' -ForegroundColor Yellow
Write-Host '  Puis F5 dans Alwatan et validez une vente.' -ForegroundColor Yellow
Write-Host ''

if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    if ($healthOk) {
        $msg = "Agent impression Alwatan demarre.`nImprimante : $PrinterName`n`nAutorisez Acces reseau local dans le navigateur si demande, puis F5."
    } else {
        $msg = "Installation faite mais agent non demarre.`n`nDouble-cliquez maintenant :`n$relancerBat"
    }
    [System.Windows.MessageBox]::Show($msg, 'Alwatan Print Agent') | Out-Null
}
