# Ouvre Alwatan Manager sur un poste client (recherche automatique du serveur).
. "$PSScriptRoot\_alwatan-common.ps1"

$Root = Get-AlwatanRoot
$projectInstalled = Test-Path (Join-Path $Root 'backend\package.json')

Write-Host ''
Write-Host '  Clinique Alwatan — Manager Pro' -ForegroundColor Cyan
Write-Host '  Connexion poste CLIENT' -ForegroundColor Cyan
Write-Host ''

$server = Find-AlwatanServer
if ($server) {
    Write-Host "Serveur trouvé : $($server.Url)" -ForegroundColor Green
    Open-AlwatanBrowser -Url $server.Url
    exit 0
}

if ($projectInstalled) {
    Write-Host 'Interface introuvable — démarrage automatique du serveur sur ce poste...' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'lancer-serveur.ps1')
    exit $LASTEXITCODE
}

$configPath = Get-AlwatanServerConfigPath
$examplePath = Join-Path $PSScriptRoot 'alwatan-server.txt.example'
if (-not (Test-Path $configPath) -and (Test-Path $examplePath)) {
    Copy-Item $examplePath $configPath
}

$message = @"
Impossible de joindre Alwatan Manager.

Vérifications :
1. Le poste serveur est allumé et le raccourci « Serveur » a été lancé.
2. Ce PC est sur le même réseau local.
3. Renseignez l'adresse IP du serveur dans :
   $configPath

Exemple :
SERVER_IP=192.168.1.50
"@

Show-AlwatanMessage -Title 'Alwatan Manager — Client' -Message $message -Type Warning
Write-Host $message -ForegroundColor Yellow
exit 1
