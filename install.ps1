# One-liner installer for claude-sharing (Windows, no admin required).
#
#   irm https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/main/install.ps1 | iex
#
# Clones/updates the app into %USERPROFILE%\.claude-sharing\app, installs +
# builds it, drops a `claude-sharing.cmd` launcher on your user PATH, and
# opens the app.

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/zacharyjleach-stack/CLAUDE-SHARING.git"
$AppDir  = Join-Path $env:USERPROFILE ".claude-sharing\app"
$BinDir  = Join-Path $env:USERPROFILE ".claude-sharing\bin"
$Ref     = $env:CLAUDE_SHARING_REF

function Require-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Error "'$name' is required. $hint"
        exit 1
    }
}

Require-Command git "Install from https://git-scm.com/download/win"
Require-Command node "Install from https://nodejs.org (LTS, no admin needed with the .msi 'just for me' option)"
Require-Command npm "Comes with Node.js — see https://nodejs.org"

Write-Host "==> Installing claude-sharing to $AppDir"
New-Item -ItemType Directory -Force -Path (Split-Path $AppDir) | Out-Null
if (Test-Path (Join-Path $AppDir ".git")) {
    git -C $AppDir fetch origin --quiet
} else {
    git clone --quiet $RepoUrl $AppDir
}
if ($Ref) {
    git -C $AppDir checkout --quiet $Ref
    git -C $AppDir pull --quiet origin $Ref
} else {
    git -C $AppDir pull --quiet
}

Write-Host "==> Installing dependencies (first run can take a minute)..."
Push-Location $AppDir
npm install --no-fund --no-audit --loglevel=error
Write-Host "==> Building..."
npm run build --silent
Pop-Location

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$Launcher = Join-Path $BinDir "claude-sharing.cmd"
@"
@echo off
cd /d "$AppDir"
call npm run start --silent --workspace apps/desktop
"@ | Set-Content -Encoding ASCII $Launcher

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "==> Added $BinDir to your user PATH (open a new terminal for it to take effect elsewhere)."
}

Write-Host "==> Launching claude-sharing..."
Start-Process -FilePath $Launcher

Write-Host ""
Write-Host "Done. Next time, just run: claude-sharing"
