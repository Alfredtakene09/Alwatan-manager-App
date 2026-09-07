# Installe TOUT pour limpression ticket (pilote POS-80 + agent ESC/POS).
# Usage: INSTALLER-COMPLET-IMPRESSION.bat (eleve le pilote en admin, puis agent).
param(
    [string]$PrinterName = 'POS-80',
    [switch]$SkipDriver,
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

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$scriptsDir = $PSScriptRoot
$agentRoot = Split-Path $scriptsDir -Parent
if (-not (Test-Path (Join-Path $agentRoot 'server.mjs'))) {
    throw "print-agent introuvable depuis $scriptsDir"
}

$driverScript = Join-Path $scriptsDir 'install-driver.ps1'
$agentScript = Join-Path $scriptsDir 'install-agent.ps1'

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' Alwatan - Installation COMPLETE impression' -ForegroundColor Cyan
Write-Host ' Pilote POS-80 (ECO250) + Agent local' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

# --- Prechecks ---
$node = Find-NodeExe
if (-not $node) {
    throw "Node.js manquant. Installez Node LTS, fermez cette fenetre, puis relancez."
}
Write-Host ("[OK] Node: {0}" -f $node) -ForegroundColor Green

# --- 1) Pilote (admin) ---
if (-not $SkipDriver) {
    Write-Host ''
    Write-Host '[1/3] Installation pilote POS-80 (droits admin)...' -ForegroundColor Cyan
    if (Test-IsAdmin) {
        & $driverScript -PrinterName $PrinterName -AlsoGenericRaw -Quiet:$Quiet
    } else {
        $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$driverScript`" -PrinterName `"$PrinterName`" -AlsoGenericRaw -Quiet"
        $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arg -Wait -PassThru
        if ($p.ExitCode -ne 0 -and $null -ne $p.ExitCode) {
            Write-Host ("Attention: install pilote code sortie {0}" -f $p.ExitCode) -ForegroundColor Yellow
        }
    }
    Start-Sleep -Seconds 1
    $prt = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
    if (-not $prt) {
        $prt = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)pos-?80|eco250' } | Select-Object -First 1
        if ($prt) { $PrinterName = $prt.Name }
    }
    if ($prt -or (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue)) {
        Write-Host ("[OK] Imprimante Windows: {0}" -f $PrinterName) -ForegroundColor Green
    } else {
        Write-Host '[!] Imprimante Windows absente apres install pilote.' -ForegroundColor Yellow
        Write-Host '    Branchez limprimante USB, allumez-la, puis relancez ce script.' -ForegroundColor Yellow
    }
} else {
    Write-Host '[1/3] Pilote ignore (-SkipDriver)' -ForegroundColor DarkGray
}

# Preferer la file Generic/Text Only pour ESC/POS (POS-80 ignore souvent le RAW)
$rawPrt = Get-Printer -Name 'Alwatan-Ticket-RAW' -ErrorAction SilentlyContinue
if ($rawPrt) {
    $PrinterName = 'Alwatan-Ticket-RAW'
    Write-Host '[OK] File RAW Alwatan-Ticket-RAW retenue pour limpression ESC/POS' -ForegroundColor Green
}

# --- 2) Agent ---
Write-Host ''
Write-Host '[2/3] Installation agent impression...' -ForegroundColor Cyan
& $agentScript -PrinterName $PrinterName -Auto -Quiet

# --- 3) Verification ---
Write-Host ''
Write-Host '[3/3] Verification...' -ForegroundColor Cyan
Start-Sleep -Seconds 2
$ok = $false
try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:19100/health' -TimeoutSec 5
    if ($h.ok -and $h.configured) {
        $ok = $true
        Write-Host ("[OK] Agent: printer={0}" -f $h.printerName) -ForegroundColor Green
    } else {
        Write-Host '[X] Agent repond mais imprimante non configuree' -ForegroundColor Red
    }
} catch {
    Write-Host '[X] Agent non joignable sur 127.0.0.1:19100' -ForegroundColor Red
}

if ($ok) {
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:19100/test' -Method Post -TimeoutSec 12 | Out-Null
        Write-Host '[OK] Ticket TEST envoye' -ForegroundColor Green
    } catch {
        Write-Host ("[!] Test impression: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

Write-Host ''
if ($ok) {
    Write-Host 'INSTALLATION REUSSIE' -ForegroundColor Green
    Write-Host '1) Ouvrez Alwatan' -ForegroundColor Cyan
    Write-Host '2) Si Chrome demande Acces reseau local -> Autoriser' -ForegroundColor Cyan
    Write-Host '3) F5 puis validez une vente / reception' -ForegroundColor Cyan
} else {
    Write-Host 'INSTALLATION INCOMPLETE' -ForegroundColor Red
    Write-Host 'Verifiez: USB allumee, Node, puis RELANCER-IMPRESSION.bat' -ForegroundColor Yellow
}
Write-Host ''

if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    $msg = if ($ok) {
        "Impression Alwatan prete.`nImprimante: $PrinterName`n`nAutorisez Acces reseau local dans Chrome si demande, puis F5."
    } else {
        "Installation incomplete.`nBranchez limprimante, puis relancez INSTALLER-COMPLET-IMPRESSION.bat"
    }
    [System.Windows.MessageBox]::Show($msg, 'Alwatan Impression') | Out-Null
}
