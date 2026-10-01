# restart-local.ps1 — 重啟本機開發環境的 backend (3000) 與 frontend (5173)
# 用法：在 PowerShell 執行  .\tools\restart-local.ps1
# 說明：
#   - backend：node src/server.js（讀 backend/.env，預設 PORT=3000）
#   - frontend：Vite dev server（npm run dev，預設 5173，/api 代理到本機 3000）
#   - 兩者皆以背景行程啟動，日誌寫入 $env:TEMP\be.out / fe.out
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$logDir   = $env:TEMP

function Stop-Port($port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "stopped PID $($c.OwningProcess) on port $port"
  } else {
    Write-Host "no listener on port $port (skip)"
  }
}

function Wait-Port($port, $secs = 20) {
  for ($i = 0; $i -lt $secs; $i++) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return $true }
    Start-Sleep 1
  }
  return $false
}

# 1) backend
Stop-Port 3000
Start-Sleep 1
Start-Process -FilePath 'node' -ArgumentList 'src/server.js' `
  -WorkingDirectory $backend `
  -RedirectStandardOutput (Join-Path $logDir 'be.out') `
  -RedirectStandardError  (Join-Path $logDir 'be.err')
Write-Host 'starting backend (node src/server.js)...'

# 2) frontend（npm 是 .cmd 腳本，須經 cmd /c 啟動）
Stop-Port 5173
Start-Sleep 1
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList "/c cd /d `"$frontend`" && npm run dev" `
  -WorkingDirectory $frontend `
  -RedirectStandardOutput (Join-Path $logDir 'fe.out') `
  -RedirectStandardError  (Join-Path $logDir 'fe.err') `
  -WindowStyle Hidden
Write-Host 'starting frontend (npm run dev)...'

# 3) 驗證
$okBE = Wait-Port 3000 20
$okFE = Wait-Port 5173 20
Write-Host "backend  (3000): $(if ($okBE) { 'LISTENING' } else { 'NOT LISTENING' })"
Write-Host "frontend (5173): $(if ($okFE) { 'LISTENING' } else { 'NOT LISTENING' })"
if ($okBE) {
  try { Write-Host "health: $(curl.exe -s -m5 http://127.0.0.1:3000/api/v1/health)" } catch {}
}
if (-not $okBE -or -not $okFE) {
  Write-Host "--- be.err ---"; Get-Content (Join-Path $logDir 'be.err') -Tail 15 -ErrorAction SilentlyContinue
  Write-Host "--- fe.err ---"; Get-Content (Join-Path $logDir 'fe.err') -Tail 15 -ErrorAction SilentlyContinue
  exit 1
}
Write-Host 'done. Local dev restarted -> http://localhost:5173/'
