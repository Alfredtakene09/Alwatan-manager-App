# Desinstalle l'agent d'impression Alwatan de CE poste.
$ErrorActionPreference = 'SilentlyContinue'

$installDir = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\print-agent'
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Alwatan Print Agent.lnk'

Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -and ($_.CommandLine -like '*print-agent*server.mjs*' -or $_.CommandLine -like '*CliniqueAlwatan\print-agent*')
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Remove-Item $lnkPath -Force -ErrorAction SilentlyContinue
Write-Host "Raccourci demarrage retire : $lnkPath"
Write-Host "Dossier conserve (logs/config) : $installDir"
Write-Host "Pour tout supprimer : Remove-Item -Recurse -Force `"$installDir`""
