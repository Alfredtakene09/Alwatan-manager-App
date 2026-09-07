# Envoie un fichier binaire ESC/POS via USB (tous les ports reels).
# Modes: Auto | Spooler | Direct
# Auto = spooler puis TOUS les ports USB ouvrables (+ interfaces USBPRINT).
param(
    [string]$PrinterName = '',
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string]$DocName = 'Alwatan Ticket',
    [ValidateSet('Auto', 'Spooler', 'Direct')][string]$Mode = 'Auto',
    [string]$DirectPort = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Fichier introuvable: $FilePath"
}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)

function Send-SpoolerRaw {
    param([string]$Name, [byte[]]$Data, [string]$Doc)
    if (-not $Name) { throw 'PrinterName vide' }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AlwatanRawPrinter4 {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static void Send(string printerName, byte[] bytes, string docName) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      throw new InvalidOperationException("OpenPrinter failed err=" + Marshal.GetLastWin32Error());
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = docName; di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di))
        throw new InvalidOperationException("StartDocPrinter failed err=" + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(hPrinter))
          throw new InvalidOperationException("StartPagePrinter failed err=" + Marshal.GetLastWin32Error());
        try {
          IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, p, bytes.Length);
            int written;
            if (!WritePrinter(hPrinter, p, bytes.Length, out written) || written != bytes.Length)
              throw new InvalidOperationException("WritePrinter failed written=" + written);
          } finally { Marshal.FreeCoTaskMem(p); }
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@ -ErrorAction SilentlyContinue
    [AlwatanRawPrinter4]::Send($Name, $Data, $Doc)
}

function Send-ToDevicePath {
    param([string]$Path, [byte[]]$Data)
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
    try {
        $fs.Write($Data, 0, $Data.Length)
        $fs.Flush()
    } finally { $fs.Close() }
}

function Test-PathWritable {
    param([string]$Path)
    try {
        $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
        $fs.Close(); return $true
    } catch { return $false }
}

function Get-UsbPrintDevicePaths {
    $paths = @()
    # 1) Ports nommes USB001.. si ouvrables
    $portNames = @()
    if ($DirectPort) { $portNames += $DirectPort }
    try {
        $portNames += @(Get-PrinterPort -EA SilentlyContinue | Where-Object { $_.Name -match '^USB\d+' } | Sort-Object Name | ForEach-Object Name)
    } catch { }
    # Aussi USB001..USB020 au cas ou le port existe sans etre dans Get-PrinterPort
    1..20 | ForEach-Object { $portNames += ('USB{0:d3}' -f $_) }
    foreach ($n in ($portNames | Select-Object -Unique)) {
        $p = "\\.\$n"
        if (Test-PathWritable -Path $p) { $paths += $p }
    }
    # 2) Interfaces USBPRINT (vrai peripherique)
    $guid = '{28d78fad-5a12-11d1-ae5b-0000f803a8c2}'
    $base = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses\$guid"
    if (Test-Path $base) {
        Get-ChildItem $base -Recurse -EA SilentlyContinue | ForEach-Object {
            try {
                $props = Get-ItemProperty $_.PSPath -EA SilentlyContinue
                if ($props.SymbolicLink) {
                    $link = [string]$props.SymbolicLink
                    if ($link -and (Test-PathWritable -Path $link)) { $paths += $link }
                }
            } catch { }
        }
    }
    return @($paths | Select-Object -Unique)
}

$errors = @()

if ($Mode -eq 'Spooler' -or $Mode -eq 'Auto') {
    if ($PrinterName) {
        try {
            Send-SpoolerRaw -Name $PrinterName -Data $bytes -Doc $DocName
            Write-Output ("OK spooler printer={0}" -f $PrinterName)
            exit 0
        } catch {
            $errors += ("spooler:{0}" -f $_.Exception.Message)
            if ($Mode -eq 'Spooler') {
                [Console]::Error.WriteLine($_.Exception.Message)
                exit 1
            }
        }
    }
}

if ($Mode -eq 'Direct' -or $Mode -eq 'Auto') {
    $targets = @(Get-UsbPrintDevicePaths)
    if ($targets.Count -eq 0) {
        $errors += 'aucun port USB reel ouvrable (USB001.. fantomes ou imprimante non detectee)'
    }
    foreach ($path in $targets) {
        try {
            Send-ToDevicePath -Path $path -Data $bytes
            Write-Output ("OK direct path={0}" -f $path)
            exit 0
        } catch {
            $errors += ("direct:{0}:{1}" -f $path, $_.Exception.Message)
        }
    }
}

[Console]::Error.WriteLine(($errors -join ' | '))
exit 1
