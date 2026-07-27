# Ouvre Alwatan sur un poste client (sans PowerShell compliqué).
. "$PSScriptRoot\_alwatan-common.ps1"

# Après connexion au Wi-Fi du serveur (partage de connexion)
$urls = @('http://192.168.137.1:4000/')
$ip = Read-AlwatanServerIp
if ($ip) { $urls += "http://${ip}:4000/" }

foreach ($url in $urls) {
    $hostName = ([Uri]$url).Host
    if (Test-AlwatanProductionApp -HostName $hostName -Port 4000 -TimeoutSec 2) {
        Write-Host "Connexion : $url" -ForegroundColor Green
        Open-AlwatanBrowser -Url $url
        exit 0
    }
}

$server = Find-AlwatanServer
if ($server) {
    Open-AlwatanBrowser -Url $server.Url
    exit 0
}

if (Test-Path (Join-Path (Get-AlwatanRoot) 'backend\package.json')) {
    & (Join-Path $PSScriptRoot 'lancer-postes-clients.ps1')
    exit $LASTEXITCODE
}

Show-AlwatanMessage -Title 'Alwatan Manager' -Message @"
Connexion impossible.

1) Connectez ce PC au Wi-Fi du SERVEUR (partage de connexion Windows).
2) Ouvrez : http://192.168.137.1:4000

Demandez au serveur de lancer « lancer-postes-clients.cmd ».
"@ -Type Warning
exit 1
