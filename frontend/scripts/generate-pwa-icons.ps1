# Génère les icônes PWA (192, 512) à partir du logo clinique.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$jpegCandidates = @(
    (Join-Path $root 'frontend\public\logo-alwatan.jpeg'),
    (Join-Path $root 'backend\src\assets\logo-alwatan.jpeg')
)
$jpeg = $jpegCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $jpeg) {
    Write-Error 'logo-alwatan.jpeg introuvable.'
}
$pub = Join-Path $root 'frontend\public'
$pwa = Join-Path $pub 'pwa'
New-Item -ItemType Directory -Force -Path $pub, $pwa | Out-Null
$destLogo = Join-Path $pub 'logo-alwatan.jpeg'
$srcPath = (Resolve-Path $jpeg).Path
$destPath = $null
if (Test-Path $destLogo) {
    $destPath = (Resolve-Path $destLogo).Path
}
if ($srcPath -ne $destPath) {
    Copy-Item $jpeg $destLogo -Force
}

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($jpeg)
foreach ($size in @(192, 512)) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::White)
    $pad = [int]($size * 0.08)
    $inner = $size - 2 * $pad
    $g.DrawImage($img, $pad, $pad, $inner, $inner)
    $g.Dispose()
    $out = Join-Path $pwa "icon-$size.png"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
$img.Dispose()
Write-Host "Icônes PWA générées dans $pwa"
