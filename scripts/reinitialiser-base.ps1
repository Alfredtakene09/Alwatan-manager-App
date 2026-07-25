# Réinitialise la base : conserve uniquement les utilisateurs par défaut.
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$nodeDir = Initialize-NodePath
$backend = Join-Path $Root "backend"

Write-Host ""
Write-Host "  Clinique Alwatan — Réinitialisation de la base" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Cette opération supprime TOUTES les données" -ForegroundColor Yellow
Write-Host "  (patients, factures, paie, dépenses, etc.)" -ForegroundColor Yellow
Write-Host "  et conserve uniquement les comptes par défaut." -ForegroundColor Yellow
Write-Host ""

$answer = Read-Host "Confirmer la réinitialisation ? (oui/non)"
if ($answer -notmatch '^(oui|o|yes|y)$') {
    Write-Host "Annulé." -ForegroundColor DarkGray
    exit 0
}

Push-Location $backend
$env:Path = "$nodeDir;$env:Path"
$env:RESET_DB_CONFIRM = "1"
& "$nodeDir\npm.cmd" run db:reset
$exitCode = $LASTEXITCODE
Pop-Location

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "Base réinitialisée avec succès." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "La réinitialisation a échoué (code $exitCode)." -ForegroundColor Red
}

exit $exitCode
