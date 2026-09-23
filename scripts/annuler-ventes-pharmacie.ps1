# Annule / remet a zero les ventes pharmacie (avec restauration du stock).
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$backend = Join-Path $Root "backend"

Write-Host ""
Write-Host "  Clinique Alwatan — Annuler / mettre a zero les ventes pharmacie" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Supprime :" -ForegroundColor Yellow
Write-Host "    historique des ventes, retours, factures pharmacie, mouvements lies" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Remet en stock :" -ForegroundColor Green
Write-Host "    quantites nettes vendues (vendu − deja retourne)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Conserve :" -ForegroundColor Green
Write-Host "    catalogue produits, categories, fournisseurs, clients externes" -ForegroundColor DarkGray
Write-Host ""

Write-Host "Simulation (aucune modification)…" -ForegroundColor Cyan
Push-Location $backend
$env:Path = "$nodeDir;$env:Path"
& "$nodeDir\npx.cmd" tsx scripts/reset-pharmacy-sales.ts --dry-run
$dryCode = $LASTEXITCODE
Pop-Location

if ($dryCode -ne 0) {
    Write-Host "Echec de la simulation (code $dryCode)." -ForegroundColor Red
    exit $dryCode
}

Write-Host ""
$answer = Read-Host "Confirmer l'annulation des ventes pharmacie ? (oui/non)"
if ($answer -notmatch '^(oui|o|yes|y)$') {
    Write-Host "Annule." -ForegroundColor DarkGray
    exit 0
}

Push-Location $backend
$env:Path = "$nodeDir;$env:Path"
& "$nodeDir\npm.cmd" run db:reset-pharmacy-sales -- --confirm
$exitCode = $LASTEXITCODE
Pop-Location

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "Ventes pharmacie annulees." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Echec (code $exitCode)." -ForegroundColor Red
}
exit $exitCode
