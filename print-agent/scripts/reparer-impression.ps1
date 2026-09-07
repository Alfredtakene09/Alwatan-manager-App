# REPARER USB v4 : teste TOUS les ports USB, nettoie les fantomes, re-enumere.
# Pas d'option reseau — USB uniquement.
param(
    [string]$UserLocalAppData = '',
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LoggedOnLocalAppData {
    $candidates = @()
    if ($env:LOCALAPPDATA) { $candidates += $env:LOCALAPPDATA }
    Get-ChildItem 'C:\Users\*\AppData\Local\CliniqueAlwatan\print-agent\server.mjs' -EA SilentlyContinue |
        ForEach-Object { $candidates += $_.Directory.Parent.Parent.FullName }
    foreach ($c in ($candidates | Select-Object -Unique)) {
        if (Test-Path (Join-Path $c 'CliniqueAlwatan\print-agent\server.mjs')) { return $c }
    }
    return $env:LOCALAPPDATA
}

function Test-PortOpenable {
    param([string]$PortName)
    try {
        $fs = [System.IO.File]::Open("\\.\$PortName", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
        $fs.Close(); return $true
    } catch { return $false }
}

function Get-AllUsbPortNames {
    $names = @()
    try {
        $names += @(Get-PrinterPort -EA SilentlyContinue | Where-Object { $_.Name -match '^USB\d+' } | ForEach-Object Name)
    } catch { }
    1..20 | ForEach-Object { $names += ('USB{0:d3}' -f $_) }
    return @($names | Select-Object -Unique | Sort-Object)
}

function Get-LiveUsbPorts {
    return @(Get-AllUsbPortNames | Where-Object { Test-PortOpenable -PortName $_ })
}

function New-TestEscPosFile {
    $bytes = [byte[]]@(0x1b, 0x40, 0x1b, 0x61, 0x01)
    $text = [System.Text.Encoding]::ASCII.GetBytes("ALWATAN TEST TOUS PORTS USB`nPharmacie`n`n")
    $bytes = $bytes + $text + [byte[]]@(0x0a, 0x0a, 0x1d, 0x56, 0x00)
    $path = Join-Path $env:TEMP ("alwatan-usb-{0}.bin" -f [guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllBytes($path, $bytes)
    return $path
}

function Send-DirectUsbFile {
    param([string]$PortName, [string]$FilePath)
    $data = [System.IO.File]::ReadAllBytes($FilePath)
    $path = "\\.\$PortName"
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
    try {
        $fs.Write($data, 0, $data.Length)
        $fs.Flush()
    } finally { $fs.Close() }
}

function Clear-GhostUsbPorts {
    Write-Host '  Suppression ports USB fantomes + files cassees...' -ForegroundColor Yellow
    foreach ($n in @('POS-80', 'Alwatan-Ticket-RAW')) {
        Get-PrintJob -PrinterName $n -EA SilentlyContinue | ForEach-Object {
            Remove-PrintJob -PrinterName $n -ID $_.Id -Confirm:$false -EA SilentlyContinue
        }
        Remove-Printer -Name $n -Confirm:$false -EA SilentlyContinue
    }
    Get-PrinterPort -EA SilentlyContinue | Where-Object { $_.Name -match '^USB\d+' } | ForEach-Object {
        $name = $_.Name
        if (-not (Test-PortOpenable -PortName $name)) {
            Write-Host ("    Remove-PrinterPort {0}" -f $name) -ForegroundColor DarkGray
            Remove-PrinterPort -Name $name -Confirm:$false -EA SilentlyContinue
        }
    }
    try { Restart-Service Spooler -Force -EA Stop; Start-Sleep -Seconds 2 } catch { }
}

function Stop-AgentOnPort {
    param([int]$Port = 19100)
    Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }
    Get-CimInstance Win32_Process -EA SilentlyContinue |
        Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*print-agent*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    Start-Sleep -Seconds 1
}

function Sync-Agent {
    param([string]$InstallDir)
    $src = Split-Path $PSScriptRoot -Parent
    New-Item -ItemType Directory -Path (Join-Path $InstallDir 'lib') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $InstallDir 'logs') -Force | Out-Null
    Copy-Item (Join-Path $src 'server.mjs') $InstallDir -Force
    Copy-Item (Join-Path $src 'lib\*') (Join-Path $InstallDir 'lib') -Force
    Copy-Item (Join-Path $src 'package.json') $InstallDir -Force -EA SilentlyContinue
    Write-Host ("[OK] Sync AppData depuis {0}" -f $src) -ForegroundColor Green
}

function Write-AgentConfig {
    param([string]$InstallDir, [string]$DirectPort)
    # directPort vide = l'agent essaie TOUS les ports USB a chaque impression
    $cfg = [ordered]@{
        port = 19100
        host = '127.0.0.1'
        interface = 'usb'
        printMode = 'Auto'
        directPort = $DirectPort
        printerName = 'Alwatan-Ticket-RAW'
        paperWidthChars = 48
        cut = $true
        openCashDrawer = $false
        codePage = 'cp850'
        logDir = 'logs'
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $InstallDir 'config.json'), ($cfg | ConvertTo-Json), $utf8)
    if ($DirectPort) {
        Write-Host ("Config: Auto + priorite {0} (puis tous les ports)" -f $DirectPort) -ForegroundColor Green
    } else {
        Write-Host 'Config: Auto — TOUS les ports USB a chaque ticket' -ForegroundColor Green
    }
}

function Start-Agent {
    param([string]$InstallDir)
    $node = (Get-Command node -EA SilentlyContinue).Source
    if (-not $node) {
        foreach ($d in @('C:\Program Files\nodejs','C:\Program Files (x86)\nodejs')) {
            if (Test-Path "$d\node.exe") { $node = "$d\node.exe"; break }
        }
    }
    if (-not $node) { throw 'Node.js introuvable' }
    Stop-AgentOnPort -Port 19100
    Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $InstallDir -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:19100/health' -TimeoutSec 5
    Write-Host ("[OK] Agent v{0} mode={1}" -f $h.version, $h.printMode) -ForegroundColor Green
    return $h
}

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  Alwatan REPARER USB v4 — TOUS les ports USB' -ForegroundColor Cyan
Write-Host '  (pas de reseau / ethernet — USB seul)' -ForegroundColor Yellow
Write-Host ''

if (-not $UserLocalAppData) { $UserLocalAppData = Get-LoggedOnLocalAppData }
$installDir = Join-Path $UserLocalAppData 'CliniqueAlwatan\print-agent'
Write-Host ("AppData: {0}" -f $installDir)

if (-not (Test-IsAdmin)) {
    Write-Host 'UAC Administrateur...' -ForegroundColor Yellow
    $self = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -UserLocalAppData `"$UserLocalAppData`"" -Wait | Out-Null
    exit 0
}

Write-Host ''
Write-Host '[1] Etat des ports USB (fantome vs reel) :' -ForegroundColor Cyan
$all = Get-AllUsbPortNames
$live = @(Get-LiveUsbPorts)
foreach ($p in $all) {
    if ($p -match '^USB0(0[1-9]|1\d|20)$' -or (Get-PrinterPort -Name $p -EA SilentlyContinue)) {
        $ok = Test-PortOpenable -PortName $p
        if ($ok) {
            Write-Host ("  {0} = REEL (ouvrable)" -f $p) -ForegroundColor Green
        } elseif (Get-PrinterPort -Name $p -EA SilentlyContinue) {
            Write-Host ("  {0} = FANTOME" -f $p) -ForegroundColor Red
        }
    }
}
Write-Host ("  Ports reels maintenant: {0}" -f ($(if ($live.Count) { $live -join ', ' } else { '(aucun)' })))

Write-Host ''
Write-Host '[2] Nettoyage fantomes + spooler...' -ForegroundColor Cyan
Clear-GhostUsbPorts

Write-Host ''
Write-Host '[3] Rebranchez limprimante USB' -ForegroundColor Cyan
Write-Host '    1) Verifiez alim 24V + LED allumee' -ForegroundColor Yellow
Write-Host '    2) Debranchez le cable USB du PC 10 secondes' -ForegroundColor Yellow
Write-Host '    3) Rebranchez sur UNE prise USB du PC' -ForegroundColor Yellow
Write-Host ''
Read-Host 'Puis appuyez sur Entree ici'

Write-Host 'Attente detection USB (60 s max)...' -ForegroundColor Cyan
$detected = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $live = @(Get-LiveUsbPorts)
    if ($live.Count -gt 0) {
        $detected = $live
        Write-Host ("  Detecte: {0}" -f ($live -join ', ')) -ForegroundColor Green
        break
    }
    Write-Host ('  ... {0}s' -f (($i + 1) * 2)) -ForegroundColor DarkGray
}

if (-not $detected) {
    Write-Host ''
    Write-Host '[X] Toujours aucun port USB REEL apres rebranchement.' -ForegroundColor Red
    Write-Host 'Windows ne voit pas limprimante. Essayez :' -ForegroundColor Yellow
    Write-Host '  - autre prise USB du PC (arriere / autre controlleur)'
    Write-Host '  - autre cable USB data'
    Write-Host '  - Gestionnaire de peripheriques > Imprimantes / USB (erreurs ?)'
    Write-Host '  - limprimante allumee (LED) avec papier'
    Write-Host ''
    Write-Host 'Lancez aussi DIAGNOSTIC-USB-REEL.bat et envoyez la photo.' -ForegroundColor Cyan
    if (-not $Quiet) { pause }
    exit 1
}

Write-Host ''
Write-Host '[4] Test impression sur TOUS les ports reels...' -ForegroundColor Cyan
$bin = New-TestEscPosFile
$winner = $null
foreach ($port in $detected) {
    Write-Host ''
    Write-Host ("--- Port {0} ---" -f $port) -ForegroundColor Magenta
    try {
        Send-DirectUsbFile -PortName $port -FilePath $bin
        Write-Host '  Bytes envoyes OK' -ForegroundColor Green
    } catch {
        Write-Host ("  Echec: {0}" -f $_.Exception.Message) -ForegroundColor Red
        continue
    }
    $ans = Read-Host ("  Papier SORTI sur {0} ? (O/N)" -f $port)
    if ($ans -match '^(o|oui|y|yes)$') {
        $winner = $port
        break
    }
}
Remove-Item $bin -Force -EA SilentlyContinue

if (-not $winner) {
    # Config quand meme en Auto tous ports — au cas ou
    Write-Host ''
    Write-Host 'Aucun papier confirme. Agent configure quand meme pour tester TOUS les ports a chaque vente.' -ForegroundColor Yellow
    Sync-Agent -InstallDir $installDir
    Write-AgentConfig -InstallDir $installDir -DirectPort ''
    try {
        Add-PrinterDriver -Name 'Generic / Text Only' -EA SilentlyContinue
        $first = $detected[0]
        Add-Printer -Name 'Alwatan-Ticket-RAW' -DriverName 'Generic / Text Only' -PortName $first -EA SilentlyContinue
    } catch { }
    [void](Start-Agent -InstallDir $installDir)
    if (-not $Quiet) { pause }
    exit 1
}

Write-Host ''
Write-Host ("[OK] Port gagnant: {0}" -f $winner) -ForegroundColor Green
Write-Host '[5] Config agent (priorite ce port + essai de tous les autres)...' -ForegroundColor Cyan
Sync-Agent -InstallDir $installDir
Write-AgentConfig -InstallDir $installDir -DirectPort $winner
try {
    Add-PrinterDriver -Name 'Generic / Text Only' -EA SilentlyContinue
    if (Get-Printer -Name 'Alwatan-Ticket-RAW' -EA SilentlyContinue) {
        Remove-Printer -Name 'Alwatan-Ticket-RAW' -Confirm:$false -EA SilentlyContinue
    }
    Add-Printer -Name 'Alwatan-Ticket-RAW' -DriverName 'Generic / Text Only' -PortName $winner -EA Stop
} catch { }

[void](Start-Agent -InstallDir $installDir)
Write-Host ''
Write-Host 'REUSSI. Chrome: Acces reseau local = Autoriser, F5, vente test.' -ForegroundColor Green
Write-Host 'A chaque ticket, l agent essaie ce port puis les autres ports USB.' -ForegroundColor Cyan
Write-Host ''
if (-not $Quiet) { pause }
