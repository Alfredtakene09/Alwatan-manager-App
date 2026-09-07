# FIX UNIQUE et DEFINITIF - poste Pharmacie / Reception
# Restaure pilote + files Windows + agent. Ne laisse JAMAIS le poste sans imprimante ticket.
param(
    [string]$UserLocalAppData = '',
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
$DriverName = 'POS-80 11.3.0.1'
$PosName = 'POS-80'
$RawName = 'Alwatan-Ticket-RAW'

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-UserLocalAppData {
    $candidates = @()
    if ($env:LOCALAPPDATA) { $candidates += $env:LOCALAPPDATA }
    Get-ChildItem 'C:\Users\*\AppData\Local\CliniqueAlwatan\print-agent\server.mjs' -EA SilentlyContinue |
        ForEach-Object { $candidates += $_.Directory.Parent.Parent.FullName }
    foreach ($c in ($candidates | Select-Object -Unique)) {
        if (Test-Path (Join-Path $c 'CliniqueAlwatan\print-agent\server.mjs')) { return $c }
    }
    return $env:LOCALAPPDATA
}

function Find-DriverInf {
    $roots = @(
        (Join-Path $PSScriptRoot '..\drivers\POS-80'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'drivers\POS-80')
    )
    foreach ($d in $roots) {
        $inf = Join-Path $d 'pos80.inf'
        if (Test-Path $inf) { return $inf }
    }
    return $null
}

function Find-NodeExe {
    $cmd = Get-Command node -EA SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    foreach ($d in @('C:\Program Files\nodejs','C:\Program Files (x86)\nodejs')) {
        if (Test-Path "$d\node.exe") { return "$d\node.exe" }
    }
    return $null
}

function Get-BestUsbPort {
    # Prefere un port USB deja present dans le spooler
    $existing = @(Get-PrinterPort -EA SilentlyContinue | Where-Object { $_.Name -match '^USB\d+' } | Sort-Object Name | ForEach-Object Name)
    if ($existing.Count -gt 0) {
        if ($existing -contains 'USB001') { return 'USB001' }
        return $existing[0]
    }
    # Sinon cree USB001 (Windows l'associe a limprimante au branchement)
    try {
        Add-PrinterPort -Name 'USB001' -ErrorAction Stop
        Write-Host '  Port USB001 cree' -ForegroundColor Green
        return 'USB001'
    } catch {
        # deja la ou autre
        if (Get-PrinterPort -Name 'USB001' -EA SilentlyContinue) { return 'USB001' }
        throw "Impossible de creer USB001: $($_.Exception.Message)"
    }
}

function Ensure-PrinterQueue {
    param([string]$Name, [string]$Driver, [string]$Port)

    $old = Get-Printer -Name $Name -EA SilentlyContinue
    if ($old) {
        # Met a jour le port si besoin, NE SUPPRIME PAS si echec recreation
        try {
            if ($old.PortName -ne $Port) {
                Set-Printer -Name $Name -PortName $Port -EA Stop
                Write-Host ("  {0}: port -> {1}" -f $Name, $Port) -ForegroundColor Green
            } else {
                Write-Host ("  {0}: deja present ({1})" -f $Name, $Port) -ForegroundColor Green
            }
            return $true
        } catch {
            Write-Host ("  {0}: maj port echouee, recreation..." -f $Name) -ForegroundColor Yellow
            Remove-Printer -Name $Name -Confirm:$false -EA SilentlyContinue
            Start-Sleep -Milliseconds 500
        }
    }
    try {
        Add-Printer -Name $Name -DriverName $Driver -PortName $Port -ErrorAction Stop
        Write-Host ("  {0}: cree ({1} sur {2})" -f $Name, $Driver, $Port) -ForegroundColor Green
        return $true
    } catch {
        Write-Host ("  {0}: ECHEC {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
        return $false
    }
}

function Clear-JobsOnly {
    param([string]$Name)
    Get-PrintJob -PrinterName $Name -EA SilentlyContinue | ForEach-Object {
        Remove-PrintJob -PrinterName $Name -ID $_.Id -Confirm:$false -EA SilentlyContinue
    }
}

function Stop-PrintAgent {
    Get-NetTCPConnection -LocalPort 19100 -State Listen -EA SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }
    Get-CimInstance Win32_Process -EA SilentlyContinue |
        Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and ($_.CommandLine -like '*print-agent*') } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    Start-Sleep -Seconds 1
}

function Sync-And-ConfigAgent {
    param([string]$InstallDir, [string]$PrinterName, [string]$UsbPort)

    $src = Split-Path $PSScriptRoot -Parent
    New-Item -ItemType Directory -Path (Join-Path $InstallDir 'lib') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $InstallDir 'logs') -Force | Out-Null
    Copy-Item (Join-Path $src 'server.mjs') $InstallDir -Force
    Copy-Item (Join-Path $src 'package.json') $InstallDir -Force -EA SilentlyContinue
    Copy-Item (Join-Path $src 'config.example.json') $InstallDir -Force -EA SilentlyContinue
    Copy-Item (Join-Path $src 'lib\*') (Join-Path $InstallDir 'lib') -Force

    $cfg = [ordered]@{
        port = 19100
        host = '127.0.0.1'
        interface = 'usb'
        printMode = 'Auto'
        directPort = $UsbPort
        printerName = $PrinterName
        paperWidthChars = 48
        cut = $true
        openCashDrawer = $false
        codePage = 'cp850'
        logDir = 'logs'
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $InstallDir 'config.json'), ($cfg | ConvertTo-Json), $utf8)
    Write-Host ("  config printerName={0} directPort={1} mode=Auto" -f $PrinterName, $UsbPort) -ForegroundColor Green
}

function Start-PrintAgent {
    param([string]$InstallDir, [string]$NodeExe)
    Stop-PrintAgent
    Start-Process -FilePath $NodeExe -ArgumentList 'server.mjs' -WorkingDirectory $InstallDir -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:19100/health' -TimeoutSec 5
    return $h
}

function Invoke-TestPrint {
    $json = '{"printerName":"Alwatan-Ticket-RAW"}'
    if (-not (Get-Printer -Name 'Alwatan-Ticket-RAW' -EA SilentlyContinue)) {
        $json = '{"printerName":"POS-80"}'
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:19100/test' -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 25
        return @{ ok = $true; data = $r; error = $null }
    } catch {
        $body = $null
        try {
            $resp = $_.Exception.Response
            if ($resp) {
                $stream = $resp.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $body = $reader.ReadToEnd()
            }
        } catch { }
        $errMsg = $_.Exception.Message
        if ($body) { $errMsg = $body }
        return @{ ok = $false; data = $null; error = $errMsg }
    }
}

# ---- main ----
Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' Alwatan FIX DEFINITIF impression USB' -ForegroundColor Cyan
Write-Host ' (restaure pilote + files + agent)' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

if (-not $UserLocalAppData) { $UserLocalAppData = Get-UserLocalAppData }
$installDir = Join-Path $UserLocalAppData 'CliniqueAlwatan\print-agent'

if (-not (Test-IsAdmin)) {
    Write-Host 'Elevation Administrateur (UAC)...' -ForegroundColor Yellow
    $self = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -UserLocalAppData `"$UserLocalAppData`"" -Wait | Out-Null
    exit 0
}

$node = Find-NodeExe
if (-not $node) { throw 'Node.js introuvable. Installez Node LTS puis relancez.' }
Write-Host ("[OK] Node: {0}" -f $node) -ForegroundColor Green

$inf = Find-DriverInf
if (-not $inf) { throw 'Pilote pos80.inf introuvable dans acces-client\print-agent\drivers\POS-80' }
Write-Host ("[OK] Pilote: {0}" -f $inf) -ForegroundColor Green

Write-Host ''
Write-Host '[1/6] Installation pilote POS-80...' -ForegroundColor Cyan
& pnputil.exe /add-driver $inf /install 2>&1 | Out-String | Write-Host
try { Add-PrinterDriver -Name $DriverName -EA SilentlyContinue } catch { }
try { Add-PrinterDriver -Name 'Generic / Text Only' -EA SilentlyContinue } catch { }

Write-Host ''
Write-Host '[2/6] Port USB...' -ForegroundColor Cyan
$usbPort = Get-BestUsbPort
Write-Host ("  Port retenu: {0}" -f $usbPort) -ForegroundColor Green

Write-Host ''
Write-Host '[3/6] Restauration files imprimante (sans laisser le poste vide)...' -ForegroundColor Cyan
# Vider jobs bloques seulement
Clear-JobsOnly -Name $PosName
Clear-JobsOnly -Name $RawName

$okPos = Ensure-PrinterQueue -Name $PosName -Driver $DriverName -Port $usbPort
$okRaw = Ensure-PrinterQueue -Name $RawName -Driver 'Generic / Text Only' -Port $usbPort

if (-not $okPos -and -not $okRaw) {
    throw 'Impossible de creer POS-80 ni Alwatan-Ticket-RAW. Verifiez limprimante USB allumee.'
}

# Remettre online
foreach ($n in @($PosName, $RawName)) {
    try {
        $w = Get-CimInstance Win32_Printer -Filter "Name='$n'" -EA SilentlyContinue
        if ($w -and $w.WorkOffline) {
            Invoke-CimMethod -InputObject $w -MethodName SetWorkOffline -Arguments @{ WorkOffline = $false } | Out-Null
        }
    } catch { }
}

try { (Get-WmiObject -Query "SELECT * FROM Win32_Printer WHERE Name='$PosName'").SetDefaultPrinter() | Out-Null } catch { }

Write-Host ''
Write-Host 'Imprimantes Windows maintenant:' -ForegroundColor Cyan
Get-Printer | Format-Table Name, DriverName, PortName, PrinterStatus -AutoSize | Out-String | Write-Host

$targetPrinter = if ($okRaw) { $RawName } elseif ($okPos) { $PosName } else { $PosName }

Write-Host ''
Write-Host '[4/6] Agent AppData + config...' -ForegroundColor Cyan
Sync-And-ConfigAgent -InstallDir $installDir -PrinterName $targetPrinter -UsbPort $usbPort

Write-Host ''
Write-Host '[5/6] Demarrage agent...' -ForegroundColor Cyan
$h = Start-PrintAgent -InstallDir $installDir -NodeExe $node
Write-Host ("  health version={0} printer={1} mode={2}" -f $h.version, $h.printerName, $h.printMode) -ForegroundColor Green
if ("$($h.printerName)" -ne $targetPrinter) {
    Write-Host ("  [!] health affiche {0}, attendu {1} - verifiez config.json" -f $h.printerName, $targetPrinter) -ForegroundColor Yellow
}

Write-Host ''
Write-Host '[6/6] Test impression...' -ForegroundColor Cyan
Write-Host '  Regardez limprimante (LED + papier).' -ForegroundColor Yellow
$test = Invoke-TestPrint
if ($test.ok) {
    Write-Host ("  Agent OK method={0} bytes={1}" -f $test.data.method, $test.data.bytes) -ForegroundColor Green
} else {
    Write-Host ("  Agent erreur: {0}" -f $test.error) -ForegroundColor Red
    $errLog = Join-Path $installDir 'logs\agent-err.log'
    if (Test-Path $errLog) {
        Write-Host '  --- agent-err.log (fin) ---' -ForegroundColor Yellow
        Get-Content $errLog -Tail 15
    }
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
if ($okPos -or $okRaw) {
    Write-Host 'FILES WINDOWS RESTAUREES.' -ForegroundColor Green
    Write-Host ("Imprimante agent: {0}" -f $targetPrinter) -ForegroundColor Green
    Write-Host ''
    Write-Host 'Si le papier ne sort pas encore:' -ForegroundColor Yellow
    Write-Host '  1) Alim 24V + USB branches, LED allumee'
    Write-Host '  2) Windows > Imprimantes > POS-80 > Imprimer une page de test'
    Write-Host '  3) Si page Windows OK: F5 dans Alwatan + Acces reseau local Autoriser'
    Write-Host '  4) Si page Windows KO: cable USB / autre prise PC / papier'
} else {
    Write-Host 'ECHEC restauration files.' -ForegroundColor Red
}
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

# Tache planifiee agent au login
try {
    $taskName = 'Alwatan-Print-Agent'
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -EA SilentlyContinue
    $action = New-ScheduledTaskAction -Execute $node -Argument 'server.mjs' -WorkingDirectory $installDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host 'Tache login Alwatan-Print-Agent OK' -ForegroundColor Green
} catch {
    Write-Host ("Tache login: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework -EA SilentlyContinue
    $msg = "Files: POS-80 + Alwatan-Ticket-RAW`nAgent: $targetPrinter`n`n1) Page de test Windows sur POS-80`n2) Chrome Acces reseau local = Autoriser`n3) F5 puis vente test"
    [System.Windows.MessageBox]::Show($msg, 'Alwatan Fix impression') | Out-Null
}
