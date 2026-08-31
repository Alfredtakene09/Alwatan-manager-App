# Remet les compteurs a zero : patients, factures, ventes, paie, etc.
# Conserve : utilisateurs, employes, catalogues, stocks actuels (produits, logistique, labo).
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$backend = Join-Path $Root "backend"

Write-Host ""
Write-Host "  Clinique Alwatan — Remise a zero (donnees operationnelles)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Supprime :" -ForegroundColor Yellow
Write-Host "    patients, visites, factures, ventes pharmacie, paie, depenses," -ForegroundColor DarkGray
Write-Host "    clôtures reception, historique mouvements stock" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Conserve :" -ForegroundColor Green
Write-Host "    utilisateurs, employes, examens, types d'operation, salles," -ForegroundColor DarkGray
Write-Host "    produits pharmacie / logistique / labo (quantites en stock)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Prochains numeros apres reset : PAT-001, FAC-001" -ForegroundColor Cyan
Write-Host ""

$answer = Read-Host "Confirmer la remise a zero ? (oui/non)"
if ($answer -notmatch '^(oui|o|yes|y)$') {
    Write-Host "Annule." -ForegroundColor DarkGray
    exit 0
}

Push-Location $backend
$env:Path = "$nodeDir;$env:Path"
& "$nodeDir\npm.cmd" run db:reset-operational -- --confirm
$exitCode = $LASTEXITCODE
Pop-Location

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "Remise a zero terminee." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Echec (code $exitCode)." -ForegroundColor Red
}

exit $exitCode
