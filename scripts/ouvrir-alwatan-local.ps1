# Ouvre Alwatan en mode appli Bureau avec le profil sans en-têtes d'impression.
# Usage : double-clic ou .\scripts\ouvrir-alwatan-local.ps1
param(
    [string]$Url = 'http://127.0.0.1:4000/'
)

. "$PSScriptRoot\_alwatan-common.ps1"
Open-AlwatanBrowser -Url $Url
