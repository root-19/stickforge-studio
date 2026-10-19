<#
.SYNOPSIS
  One-time setup for StickForge Studio on Windows.
.DESCRIPTION
  Checks Node.js and FFmpeg (offers to install missing tools with winget after
  asking you), installs npm packages and builds the app. Nothing is downloaded
  without your confirmation except npm packages (needed to run the app).
.PARAMETER Yes
  Answer "yes" to install prompts (for unattended setup).
#>
param([switch]$Yes)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ask($question) {
  if ($Yes) { return $true }
  $a = Read-Host "$question [y/N]"
  return $a -match '^(y|yes)$'
}
function Has-Winget { return [bool](Get-Command winget -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Host "StickForge Studio setup" -ForegroundColor White
Write-Host "Folder: $root"

# --- Node.js -----------------------------------------------------------------
Write-Step "Checking Node.js (22.13 or newer; 24 LTS recommended)"
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeOk = $false
if ($node) {
  $v = (& node -p "process.versions.node").Trim()
  $parts = $v.Split(".") | ForEach-Object { [int]$_ }
  $nodeOk = ($parts[0] -gt 22) -or ($parts[0] -eq 22 -and $parts[1] -ge 13)
  Write-Host "Found Node.js $v"
}
if (-not $nodeOk) {
  Write-Host "Node.js 22.13+ is required (StickForge uses the built-in node:sqlite module)." -ForegroundColor Yellow
  if ((Has-Winget) -and (Ask "Install Node.js LTS now with winget?")) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
  } else {
    Write-Host "Install Node.js 24 LTS from https://nodejs.org and run this script again." -ForegroundColor Red
    exit 1
  }
}

# --- FFmpeg ------------------------------------------------------------------
Write-Step "Checking FFmpeg (needed for media import, MP3 and video export)"
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  $wingetFf = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Directory -Filter "*FFmpeg*" -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue } | Select-Object -First 1
  if ($wingetFf) { Write-Host "Found FFmpeg (winget): $($wingetFf.FullName)" }
}
if (-not $ffmpeg -and -not $wingetFf) {
  Write-Host "FFmpeg was not found." -ForegroundColor Yellow
  if ((Has-Winget) -and (Ask "Install FFmpeg (Gyan full build, ~100 MB) with winget?")) {
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
  } else {
    Write-Host "You can install it later: winget install --id Gyan.FFmpeg -e   (or set the path in Settings)." -ForegroundColor Yellow
  }
} elseif ($ffmpeg) {
  Write-Host ("Found " + (& ffmpeg -hide_banner -version | Select-Object -First 1))
}

# --- npm packages --------------------------------------------------------------
Write-Step "Installing npm packages"
if (Test-Path package-lock.json) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed." -ForegroundColor Red; exit 1 }

# --- Build -------------------------------------------------------------------
Write-Step "Building the app"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed. See the errors above." -ForegroundColor Red; exit 1 }

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Start StickForge with:  start.cmd   (or: powershell -File scripts\start.ps1)"
Write-Host "Then open the Voice Manager to download a free voice (needs internet once)."
