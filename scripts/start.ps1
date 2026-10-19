<#
.SYNOPSIS
  Start StickForge Studio on http://127.0.0.1:<port> and open it in the browser.
.PARAMETER Port
  Port to use (default 3210). The server only listens on 127.0.0.1 (this computer).
.PARAMETER Dev
  Run the Next.js development server (hot reload) instead of the production build.
.PARAMETER NoBrowser
  Don't open a browser window.
#>
param([int]$Port = 3210, [switch]$Dev, [switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "node_modules\next")) {
  Write-Host "Dependencies are not installed. Run setup.cmd (or scripts\setup.ps1) first." -ForegroundColor Red
  exit 1
}

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host "Port $Port is already in use (PID $($busy[0].OwningProcess)). StickForge may already be running at http://127.0.0.1:$Port" -ForegroundColor Yellow
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
  exit 0
}

$next = Join-Path $root "node_modules\next\dist\bin\next"
if ($Dev) {
  $nextArgs = @($next, "dev", "-H", "127.0.0.1", "-p", "$Port")
} else {
  if (-not (Test-Path ".next\BUILD_ID")) {
    Write-Host "No production build found - building (one time)..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { exit 1 }
  }
  $nextArgs = @($next, "start", "-H", "127.0.0.1", "-p", "$Port")
}

if (-not $NoBrowser) {
  # Open the browser once the server answers.
  Start-Job -ArgumentList $Port -ScriptBlock {
    param($p)
    for ($i = 0; $i -lt 120; $i++) {
      try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$p/api/system" -TimeoutSec 2 | Out-Null; Start-Process "http://127.0.0.1:$p"; return } catch { Start-Sleep -Milliseconds 500 }
    }
  } | Out-Null
}

Write-Host "StickForge Studio -> http://127.0.0.1:$Port   (press Ctrl+C to stop)" -ForegroundColor Green
& node @nextArgs
