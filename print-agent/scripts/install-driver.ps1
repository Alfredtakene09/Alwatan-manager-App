# Installe le pilote POS-80 (E-PoS ECO250 / ticket 80mm) sur CE poste Windows.
# A lancer en Administrateur.
param(
    [string]$PrinterName = 'POS-80',
    [string]$DriverName = 'POS-80 11.3.0.1',
    [switch]$AlsoGenericRaw,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    throw 'Droits Administrateur requis. Relancez INSTALLER-PILOTE.bat (UAC).'
}

$driverDir = Join-Path $PSScriptRoot '..\drivers\POS-80'
if (-not (Test-Path (Join-Path $driverDir 'pos80.inf'))) {
    $driverDir = Join-Path $PSScriptRoot 'drivers\POS-80'
}
if (-not (Test-Path (Join-Path $driverDir 'pos80.inf'))) {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $driverDir = Join-Path $root 'print-agent\drivers\POS-80'
}
$inf = Join-Path $driverDir 'pos80.inf'
if (-not (Test-Path $inf)) {
    throw "Pilote introuvable: $inf"
}

Write-Host ''
Write-Host '  Alwatan - Installation pilote E-PoS ECO250 / POS-80' -ForegroundColor Cyan
Write-Host ("  Source: {0}" -f $driverDir)
Write-Host ''

# 1) Installer le pilote dans le magasin Windows
Write-Host '[1/4] Installation du pilote POS-80...' -ForegroundColor Cyan
$pnp = & pnputil.exe /add-driver $inf /install 2>&1 | Out-String
Write-Host $pnp

# Assurer le driver d'imprimante
$existingDriver = Get-PrinterDriver -Name $DriverName -ErrorAction SilentlyContinue
if (-not $existingDriver) {
    try {
        Add-PrinterDriver -Name $DriverName -ErrorAction Stop
        Write-Host ("Driver ajoute: {0}" -f $DriverName) -ForegroundColor Green
    } catch {
        Write-Host ("Add-PrinterDriver: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        Write-Host 'Continuation (le driver peut deja etre present via pnputil)...' -ForegroundColor Yellow
    }
} else {
    Write-Host ("Driver deja present: {0}" -f $DriverName) -ForegroundColor Green
}

# 2) Trouver un port USB imprimante
Write-Host '[2/4] Detection port USB...' -ForegroundColor Cyan
$usbPorts = @(Get-PrinterPort -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '^USB\d+' -or $_.Name -match '^USBpos' -or $_.Name -match '^USB0'
} | Sort-Object Name)

# Preferer ports avec imprimante deja branchee / USB001
$portName = $null
foreach ($p in $usbPorts) {
    if ($p.Name -eq 'USB001') { $portName = $p.Name; break }
}
if (-not $portName -and $usbPorts.Count -gt 0) {
    $portName = $usbPorts[0].Name
}

if (-not $portName) {
    Write-Host 'Aucun port USB imprimante detecte. Creation de USB001...' -ForegroundColor Yellow
    try {
        Add-PrinterPort -Name 'USB001' -ErrorAction Stop
        $portName = 'USB001'
    } catch {
        Write-Host 'Branchez limprimante USB puis relancez ce script.' -ForegroundColor Red
        throw $_.Exception.Message
    }
}
Write-Host ("Port: {0}" -f $portName) -ForegroundColor Green

# 3) Creer / recreer limprimante
Write-Host '[3/4] Creation imprimante Windows...' -ForegroundColor Cyan
$old = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($old) {
    Write-Host ("Suppression ancienne imprimante {0}..." -f $PrinterName) -ForegroundColor Yellow
    Remove-Printer -Name $PrinterName -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
# Nettoyer copies type POS-80(copy of 1)
Get-Printer -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match ('(?i)^{0}' -f [regex]::Escape($PrinterName))
} | ForEach-Object {
    if ($_.Name -ne $PrinterName) {
        Write-Host ("Suppression: {0}" -f $_.Name) -ForegroundColor Yellow
        Remove-Printer -Name $_.Name -Confirm:$false -ErrorAction SilentlyContinue
    }
}

Add-Printer -Name $PrinterName -DriverName $DriverName -PortName $portName -ErrorAction Stop
Write-Host ("Imprimante creee: {0} ({1} sur {2})" -f $PrinterName, $DriverName, $portName) -ForegroundColor Green

try {
    Set-Printer -Name $PrinterName -Shared $false -ErrorAction SilentlyContinue
    (Get-WmiObject -Query ("SELECT * FROM Win32_Printer WHERE Name='{0}'" -f $PrinterName)).SetDefaultPrinter() | Out-Null
} catch { }

# 4) Option: Generic / Text Only pour RAW ESC/POS (agent Alwatan)
if ($AlsoGenericRaw) {
    $rawName = 'Alwatan-Ticket-RAW'
    Write-Host '[4/4] Imprimante RAW Generic/Text Only (recommandee agent)...' -ForegroundColor Cyan
    try {
        Add-PrinterDriver -Name 'Generic / Text Only' -ErrorAction SilentlyContinue
        $rawOld = Get-Printer -Name $rawName -ErrorAction SilentlyContinue
        if ($rawOld) { Remove-Printer -Name $rawName -Confirm:$false -ErrorAction SilentlyContinue }
        Add-Printer -Name $rawName -DriverName 'Generic / Text Only' -PortName $portName -ErrorAction Stop
        Write-Host ("Imprimante RAW: {0}" -f $rawName) -ForegroundColor Green
    } catch {
        Write-Host ("RAW non creee: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
} else {
    Write-Host '[4/4] Skip Generic RAW (utiliser -AlsoGenericRaw pour la creer)' -ForegroundColor DarkGray
}

# Configurer agent impression si present
$agentConfig = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\print-agent\config.json'
if (Test-Path $agentConfig) {
    try {
        $cfg = Get-Content $agentConfig -Raw | ConvertFrom-Json
        $cfg.printerName = $PrinterName
        $cfg.interface = 'usb'
        $cfg | ConvertTo-Json | Set-Content $agentConfig -Encoding UTF8
        Write-Host ("Agent Alwatan mis a jour: printerName={0}" -f $PrinterName) -ForegroundColor Green
    } catch {
        Write-Host 'Config agent non mise a jour (installez l agent ensuite).' -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host 'Imprimantes actuelles:' -ForegroundColor Cyan
Get-Printer | Format-Table Name, DriverName, PortName, PrinterStatus -AutoSize

Write-Host ''
Write-Host 'OK - Pilote POS-80 / ECO250 installe.' -ForegroundColor Green
Write-Host 'Ensuite: RELANCER-IMPRESSION.bat puis vente test dans Alwatan.' -ForegroundColor Cyan
Write-Host ''

if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    [System.Windows.MessageBox]::Show(
        "Pilote POS-80 installe.`nImprimante: $PrinterName`nPort: $portName`n`nLancez ensuite RELANCER-IMPRESSION.bat",
        'Alwatan - Pilote imprimante'
    ) | Out-Null
}
