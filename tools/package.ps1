<#
.SYNOPSIS
  QRCode feedback system - produce a "test environment" deployment package.
.DESCRIPTION
  Copies backend/ and frontend/ (with their package-lock.json) and docs into a
  clean staging folder, excluding node_modules / dist / data (SQLite) / .git /
  .env / *.log, then compresses to deploy/QRCode-Feedback-Test-<yyyyMMdd>.zip.
  The target machine unzips (keeping backend/ and frontend/ as siblings),
  runs npm ci + frontend build + backend start (README mode B).
#>

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$date = Get-Date -Format 'yyyyMMdd'
$name = "QRCode-Feedback-Test-$date"
$staging = [System.IO.Path]::Combine($root, 'deploy', 'staging', $name)
$zip = [System.IO.Path]::Combine($root, 'deploy', "$name.zip")

# directory exclusions (by folder name, anywhere)
$xd = @('node_modules', 'dist', 'data', '.git', '.cache', 'coverage')
# file exclusions
$xfLiteral = @('.env')
$xfWild = @('*.log', '*.local', '*.tsbuildinfo')

function Copy-ItemTree($src, $dst) {
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  foreach ($item in Get-ChildItem -Path $src) {
    if ($xd -contains $item.Name) { continue }
    $target = Join-Path $dst $item.Name
    if ($item.PSIsContainer) {
      Copy-ItemTree $item.FullName $target
    } else {
      $skip = $xfLiteral -contains $item.Name
      if (-not $skip) {
        foreach ($w in $xfWild) { if ($item.Name -like $w) { $skip = $true; break } }
      }
      if ($skip) { continue }
      Copy-Item $item.FullName $target -Force
    }
  }
}

# clean old staging / old zip
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Write-Host '==> Copying source (excluding node_modules/dist/data/.git/.env/*.log)'
Copy-ItemTree (Join-Path $root 'backend')  (Join-Path $staging 'backend')
Copy-ItemTree (Join-Path $root 'frontend') (Join-Path $staging 'frontend')
Copy-ItemTree (Join-Path $root 'docs')     (Join-Path $staging 'docs')

# root-level files to keep.
# Copy package.json / package-lock.json explicitly; copy all root *.md (README, spec, deploy guide)
# via glob to avoid hardcoding non-ASCII filenames (script is read as ANSI by Windows PowerShell).
foreach ($f in @('package.json', 'package-lock.json')) {
  $sp = Join-Path $root $f
  if (Test-Path $sp) { Copy-Item $sp (Join-Path $staging $f) -Force }
  else { Write-Warning "root file missing (skipped): $f" }
}
Get-ChildItem -Path $root -Filter '*.md' | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $staging $_.Name) -Force
  Write-Host ('  copied root md: ' + $_.Name)
}

# ensure backend/.env.example is in the package
$envEx = [System.IO.Path]::Combine($root, 'backend', '.env.example')
$envDst = [System.IO.Path]::Combine($staging, 'backend', '.env.example')
if (-not (Test-Path $envDst) -and (Test-Path $envEx)) {
  Copy-Item $envEx $envDst -Force
}

# sanity: staging must have content
$copied = (Get-ChildItem -Recurse $staging).Count
if ($copied -eq 0) { throw 'staging is empty - copy failed' }

# compress (contents of staging become zip root: backend/ and frontend/ siblings)
Write-Host '==> Compressing to $zip'
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force

# cleanup staging
Remove-Item $staging -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host ''
Write-Host 'OK: deployment package produced'
Write-Host "  path : $zip"
Write-Host "  size : $size MB"
Write-Host '  tree : backend/ (with .env.example, package-lock.json), frontend/, docs/, README.md, deploy guide'
Write-Host '  NOTE : keep backend/ and frontend/ as siblings after unzip (backend serves frontend/dist).'
