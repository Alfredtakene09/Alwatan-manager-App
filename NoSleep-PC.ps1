# Empêche veille PC + extinction d'écran tant que la fenêtre reste ouverte.
# Relâché automatiquement à la fermeture (Ctrl+C ou croix).

$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Alwatan - Pas de veille (ecran actif)'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AlwatanNoSleep {
  public const uint ES_CONTINUOUS = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_DISPLAY_REQUIRED = 0x00000002;
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@ -ErrorAction Stop

function Enable-NoSleep {
    [void][AlwatanNoSleep]::SetThreadExecutionState(
        [AlwatanNoSleep]::ES_CONTINUOUS -bor
        [AlwatanNoSleep]::ES_SYSTEM_REQUIRED -bor
        [AlwatanNoSleep]::ES_DISPLAY_REQUIRED
    )
}

function Disable-NoSleep {
    [void][AlwatanNoSleep]::SetThreadExecutionState([AlwatanNoSleep]::ES_CONTINUOUS)
}

# Sauvegarde / force aussi powercfg (secteur AC) pendant l'execution
$prevStandby = $null
$prevHibernate = $null
$prevMonitor = $null
try {
    $scheme = (powercfg /getactivescheme) 2>$null
    # Applique des timeouts "jamais" pour AC (ecran + veille)
    powercfg /change standby-timeout-ac 0 2>$null | Out-Null
    powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null
    powercfg /change monitor-timeout-ac 0 2>$null | Out-Null
    powercfg /hibernate off 2>$null | Out-Null
} catch { }

Enable-NoSleep

Clear-Host
Write-Host ''
Write-Host '  ========================================' -ForegroundColor Cyan
Write-Host '   Alwatan - PC + ecran restent allumes' -ForegroundColor Cyan
Write-Host '  ========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  - Veille systeme : BLOQUEE' -ForegroundColor Green
Write-Host '  - Extinction ecran : BLOQUEE' -ForegroundColor Green
Write-Host '  - Hibernation : desactivee (AC)' -ForegroundColor Green
Write-Host ''
Write-Host '  Laissez CETTE fenetre ouverte.' -ForegroundColor Yellow
Write-Host '  Fermez-la (ou Ctrl+C) pour rendre' -ForegroundColor Yellow
Write-Host '  les reglages Windows normaux.' -ForegroundColor Yellow
Write-Host ''

$exitHandler = {
    Disable-NoSleep
    # Remet un comportement raisonnable a la fermeture (ecran 20 min, pas de veille)
    try {
        powercfg /change standby-timeout-ac 0 2>$null | Out-Null
        powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null
        powercfg /change monitor-timeout-ac 20 2>$null | Out-Null
    } catch { }
}

try {
    [Console]::TreatControlCAsInput = $false
} catch { }

Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $exitHandler -ErrorAction SilentlyContinue | Out-Null

try {
    $n = 0
    while ($true) {
        Enable-NoSleep
        $n++
        $ts = Get-Date -Format 'HH:mm:ss'
        Write-Host ("  [{0}] actif (rafraichi #{1}) - Ctrl+C pour arreter" -f $ts, $n) -ForegroundColor DarkGray
        Start-Sleep -Seconds 50
    }
} finally {
    Write-Host ''
    Write-Host '  Arret : ecran pourra s eteindre selon Windows.' -ForegroundColor Yellow
    & $exitHandler
}
