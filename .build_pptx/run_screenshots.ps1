$ErrorActionPreference = 'Stop'
$root = 'c:\Users\606610\CodeBuddy\QRCode 客戶意見反饋'
$build = "$root\.build_pptx"

function KillPort($port) {
  try {
    $pids = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess
    foreach ($p in $pids) { if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }
  } catch {}
}
function WaitPort($port) {
  for ($i = 0; $i -lt 90; $i++) {
    try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $port); $c.Close(); return $true }
    catch { Start-Sleep -Seconds 1 }
  }
  return $false
}

# start backend
$be = Start-Process -NoNewWindow -WorkingDirectory "$root\backend" -FilePath "node" -ArgumentList "src/server.js" `
  -RedirectStandardOutput "$build\backend.log" -RedirectStandardError "$build\backend.err"
# start frontend dev (vite on 5173, proxies /api -> 3000)
# 直接以 node 執行 vite 進入點（npm 非 Win32 exe，Start-Process 無法直接啟動）
$fe = Start-Process -NoNewWindow -WorkingDirectory "$root\frontend" -FilePath "node" -ArgumentList "node_modules/vite/bin/vite.js" `
  -RedirectStandardOutput "$build\frontend.log" -RedirectStandardError "$build\frontend.err"

$okB = WaitPort 3000
$okF = WaitPort 5173
if (-not ($okB -and $okF)) {
  Write-Output "server ports not ready (backend=$okB frontend=$okF)"
  KillPort 3000; KillPort 5173
  exit 1
}
Write-Output "servers ready"

Set-Location $build
node screenshot.js

# cleanup
KillPort 3000
KillPort 5173
Write-Output "cleanup done"
