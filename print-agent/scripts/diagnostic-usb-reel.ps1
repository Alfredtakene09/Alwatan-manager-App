# Decouvre les vrais peripheriques USBPRINT (pas les ports fantomes USB001..).
# Retourne les chemins CreateFile utilisables, ex: \\?\usb#vid_...

$ErrorActionPreference = 'Continue'

function Get-UsbPrintInterfaces {
    $guid = '{28d78fad-5a12-11d1-ae5b-0000f803a8c2}' # GUID_DEVINTERFACE_USBPRINT
    $base = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses\$guid"
    $paths = @()
    if (-not (Test-Path $base)) { return $paths }
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
        Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $p = Get-ItemProperty $_.PSPath -ErrorAction Stop
                if ($p.SymbolicLink) { $paths += [string]$p.SymbolicLink }
                if ($p.DeviceInstance) { }
            } catch { }
            try {
                $d = Get-ItemProperty (Join-Path $_.PSPath '#\Control') -ErrorAction SilentlyContinue
                if ($d -and $d.Linked) { }
            } catch { }
            # Linked path often in #\Device Parameters or property SymbolicLink on # key
            Get-ChildItem $_.PSPath -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                try {
                    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
                    if ($props.SymbolicLink) { $paths += [string]$props.SymbolicLink }
                } catch { }
            }
        }
    }
    return @($paths | Where-Object { $_ } | Select-Object -Unique)
}

function Get-PrinterPnpStatus {
    $rows = @()
    Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
        $_.Class -eq 'Printer' -or
        $_.Class -eq 'USB' -or
        $_.FriendlyName -match '(?i)POS|ECO|print|ticket|receipt|E-PoS|USB Printing Support'
    } | ForEach-Object {
        $rows += [pscustomobject]@{
            Name   = $_.FriendlyName
            Class  = $_.Class
            Status = $_.Status
            InstanceId = $_.InstanceId
        }
    }
    # Fallback WMI
    if ($rows.Count -eq 0) {
        Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -match '(?i)POS|ECO|USB Printing|Printer'
        } | ForEach-Object {
            $rows += [pscustomobject]@{
                Name = $_.Name
                Class = $_.PNPClass
                Status = $_.Status
                InstanceId = $_.DeviceID
            }
        }
    }
    return $rows
}

Write-Host ''
Write-Host '  Alwatan - Peripheriques impression (PnP reel)' -ForegroundColor Cyan
Write-Host ''

Write-Host 'Files Windows (spooler) :' -ForegroundColor Cyan
Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  {0}  Port={1}  Driver={2}" -f $_.Name, $_.PortName, $_.DriverName)
}

Write-Host ''
Write-Host 'Ports spooler USB* (peuvent etre FANTOMES) :' -ForegroundColor Cyan
Get-PrinterPort -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^USB' } | ForEach-Object {
    $openable = $false
    try {
        $fs = [System.IO.File]::Open("\\.\$($_.Name)", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
        $fs.Close()
        $openable = $true
    } catch { }
    $tag = if ($openable) { 'OUVERTURE OK' } else { 'FANTOME (\\.\ introuvable)' }
    $color = if ($openable) { 'Green' } else { 'Red' }
    Write-Host ("  {0} -> {1}" -f $_.Name, $tag) -ForegroundColor $color
}

Write-Host ''
Write-Host 'Peripheriques PnP (imprimante / USB print) :' -ForegroundColor Cyan
$pnp = @(Get-PrinterPnpStatus)
if ($pnp.Count -eq 0) {
    Write-Host '  [X] AUCUN peripherique imprimante USB detecte par Windows' -ForegroundColor Red
    Write-Host '      => cable / alim / imprimante eteinte / port USB HS' -ForegroundColor Yellow
} else {
    foreach ($d in $pnp) {
        $color = if ($d.Status -eq 'OK') { 'Green' } else { 'Yellow' }
        Write-Host ("  [{0}] {1} ({2})" -f $d.Status, $d.Name, $d.Class) -ForegroundColor $color
    }
}

Write-Host ''
Write-Host 'Interfaces USBPRINT (chemins CreateFile) :' -ForegroundColor Cyan
$ifaces = @(Get-UsbPrintInterfaces)
if ($ifaces.Count -eq 0) {
    Write-Host '  [X] Aucune interface USBPRINT active' -ForegroundColor Red
    Write-Host '      Windows ne voit pas limprimante en USB maintenant.' -ForegroundColor Yellow
} else {
    foreach ($p in $ifaces) {
        Write-Host ("  {0}" -f $p) -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Ports COM (serie ECO250) :' -ForegroundColor Cyan
Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  {0} - {1}" -f $_.DeviceID, $_.Description)
}
if (-not (Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue)) {
    Write-Host '  (aucun)' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Conclusion :' -ForegroundColor Cyan
$hasLiveUsb = $false
Get-PrinterPort -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^USB' } | ForEach-Object {
    try {
        $fs = [System.IO.File]::Open("\\.\$($_.Name)", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
        $fs.Close(); $script:hasLiveUsb = $true
    } catch { }
}
if ($ifaces.Count -gt 0 -or $hasLiveUsb) {
    Write-Host '  USB reel detecte - relancer REPARER-IMPRESSION.bat' -ForegroundColor Green
} else {
    Write-Host '  Pas de USB reel. Verifiez :' -ForegroundColor Yellow
    Write-Host '   - Alim 24V + LED allumee'
    Write-Host '   - Cable USB data, autre prise du PC'
    Write-Host '   - Debrancher 10s puis rebrancher'
    Write-Host '   - Puis REPARER-IMPRESSION.bat (nettoie fantomes + teste TOUS les ports)'
}
Write-Host ''
