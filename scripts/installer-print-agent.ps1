# Installe l'agent d'impression ESC/POS sur ce poste (Réception / Pharmacie).
param(
    [string]$PrinterName = '',
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$installer = Join-Path $root 'print-agent\scripts\install-agent.ps1'
if (-not (Test-Path $installer)) {
    throw "Script introuvable : $installer"
}

& $installer -SourceDir $root -PrinterName $PrinterName -Quiet:$Quiet
