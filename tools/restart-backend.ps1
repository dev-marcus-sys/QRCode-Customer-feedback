$here = Split-Path $MyInvocation.MyCommand.Path
$root = Split-Path $here
$backend = Join-Path $root 'backend'
$backend = Resolve-Path $backend
$err = Join-Path $env:TEMP 'be.err'
$out = Join-Path $env:TEMP 'be.out'

$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  Write-Host "stopped $($conn.OwningProcess)"
} else {
  Write-Host 'no listener'
}
Start-Sleep -Seconds 1
Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $backend -RedirectStandardOutput $out -RedirectStandardError $err
Start-Sleep -Seconds 5
$up = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($up) { Write-Host "LISTENING PID=$($up.OwningProcess)" } else {
  Write-Host 'NOT LISTENING'
  Get-Content $err -Tail 20
}
