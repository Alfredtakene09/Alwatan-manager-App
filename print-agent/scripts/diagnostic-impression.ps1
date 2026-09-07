# Diagnostic simple — affiche l'erreur 500 complete
$ErrorActionPreference = 'Continue'

Write-Host ''
Write-Host '  Alwatan - diagnostic impression' -ForegroundColor Cyan
Write-Host ''

function Find-NodeExe {
    $cmd = Get-Command node -EA SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    foreach ($d in @('C:\Program Files\nodejs','C:\Program Files (x86)\nodejs')) {
        if (Test-Path "$d\node.exe") { return "$d\node.exe" }
    }
    return $null
}

$node = Find-NodeExe
$installDir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\print-agent'
Write-Host ("Node: {0}" -f ($(if ($node) { $node } else { 'ABSENT' })))
Write-Host ("Agent: {0}" -f ($(if (Test-Path "$installDir\server.mjs") { 'installe' } else { 'ABSENT' })))

if (Test-Path "$installDir\config.json") {
    $cfg = Get-Content "$installDir\config.json" -Raw
    if ($cfg[0] -eq [char]0xFEFF) { $cfg = $cfg.Substring(1) }
    $j = $cfg | ConvertFrom-Json
    Write-Host ("Config printerName={0} mode={1}" -f $j.printerName, $j.printMode)
}

Write-Host ''
Write-Host 'Imprimantes Windows:' -ForegroundColor Cyan
$printers = @(Get-Printer -EA SilentlyContinue)
if ($printers.Count -eq 0) {
    Write-Host '  (aucune)' -ForegroundColor Red
} else {
    $printers | ForEach-Object {
        Write-Host ("  {0} | Port={1} | Driver={2}" -f $_.Name, $_.PortName, $_.DriverName)
    }
}

$hasTicket = $printers | Where-Object { $_.Name -match 'POS-80|Alwatan-Ticket' }
if (-not $hasTicket) {
    Write-Host ''
    Write-Host '[X] Aucune file ticket (POS-80 / Alwatan-Ticket-RAW).' -ForegroundColor Red
    Write-Host '    => Lancez FIXER-IMPRESSION.bat (un seul fichier a lancer).' -ForegroundColor Yellow
}

Write-Host ''
$agentOk = $false
try {
    $h = Invoke-RestMethod http://127.0.0.1:19100/health -TimeoutSec 3
    Write-Host ("[OK] Agent v{0} printer={1}" -f $h.version, $h.printerName) -ForegroundColor Green
    $agentOk = $true
} catch {
    Write-Host '[X] Agent non demarre — tentative...' -ForegroundColor Yellow
    if ($node -and (Test-Path "$installDir\server.mjs")) {
        Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $installDir -WindowStyle Hidden
        Start-Sleep -Seconds 3
        try {
            $h = Invoke-RestMethod http://127.0.0.1:19100/health -TimeoutSec 3
            Write-Host ("[OK] Agent v{0} printer={1}" -f $h.version, $h.printerName) -ForegroundColor Green
            $agentOk = $true
        } catch {
            Write-Host '[X] Toujours injoignable' -ForegroundColor Red
        }
    }
}

if ($agentOk) {
    $t = Read-Host 'Test papier maintenant ? (O/N)'
    if ($t -match '^(o|oui|y|yes)$') {
        try {
            $r = Invoke-RestMethod http://127.0.0.1:19100/test -Method Post -TimeoutSec 20
            Write-Host ("OK method={0} printer={1}" -f $r.method, $r.printerName) -ForegroundColor Green
        } catch {
            Write-Host 'ECHEC test:' -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
            try {
                $resp = $_.Exception.Response
                if ($resp) {
                    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
                    Write-Host $reader.ReadToEnd() -ForegroundColor Yellow
                }
            } catch { }
            Write-Host ''
            Write-Host '=> Lancez FIXER-IMPRESSION.bat' -ForegroundColor Yellow
        }
    }
} else {
    Write-Host '=> Lancez FIXER-IMPRESSION.bat' -ForegroundColor Yellow
}
Write-Host ''
