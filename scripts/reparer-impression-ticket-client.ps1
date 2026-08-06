# Réinitialise le profil d'impression Alwatan sur CE poste (portrait + ticket 80 mm).
# À exécuter sur le PC client pharmacie si le ticket avance trop de papier / sort en paysage.
param([switch]$Quiet)

. "$PSScriptRoot\_alwatan-common.ps1"

Write-Host ''
Write-Host '  Alwatan — réparation impression ticket (poste client)' -ForegroundColor Cyan
Write-Host ''

# Fermer les fenêtres appli pour pouvoir réécrire Preferences
try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.Name -match '^(msedge|chrome)\.exe$') -and
            $_.CommandLine -and
            ($_.CommandLine -like '*CliniqueAlwatan\app-browser*' -or $_.CommandLine -like '*CliniqueAlwatan/app-browser*')
        } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Start-Sleep -Milliseconds 600
} catch { }

$profileDir = Ensure-AlwatanAppBrowserProfile
Write-Host "Profil navigateur réécrit :" -ForegroundColor Green
Write-Host "  $profileDir"
Write-Host ''
Write-Host 'Réglages appliqués :' -ForegroundColor Cyan
Write-Host '  • Orientation : Portrait (pas Paysage)'
Write-Host '  • Format préféré : Alwatan Ticket 80×120 mm'
Write-Host '  • Marges : aucune'
Write-Host '  • Pas d’ajustement « Fit to page »'
Write-Host ''
Write-Host 'Sur Windows (imprimante thermique), vérifiez aussi :' -ForegroundColor Yellow
Write-Host '  1. Paramètres > Bluetooth et appareils > Imprimantes'
Write-Host '  2. Votre imprimante ticket > Préférences d’impression'
Write-Host '  3. Format / Paper Size = Roll Paper 80 mm (ou User Defined 80×120)'
Write-Host '  4. Orientation = Portrait'
Write-Host '  5. Enregistrer comme valeurs par défaut'
Write-Host ''
Write-Host 'Puis relancez Alwatan avec le raccourci « Alwatan Manager (Client) ».' -ForegroundColor Green
Write-Host ''

if (-not $Quiet) {
    Show-AlwatanMessage -Title 'Alwatan — Impression ticket' -Message @"
Profil d'impression réparé sur ce poste.

1) Relancez « Alwatan Manager (Client) »
2) Dans les préférences de l'imprimante thermique Windows : format 80 mm + Portrait

Si le rouleau avance encore trop, le pilote Windows utilise encore un papier A4 — changez le format papier par défaut de l'imprimante (pas seulement dans le navigateur).
"@
}
