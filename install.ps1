# install.ps1 — install claude-sharing on Windows and optionally run first-time setup
#
# Usage (from a local clone):
#   .\install.ps1 --repo https://github.com/zacharyjleach-stack/CLAUDE-SHARING.git
#
# Usage (remote, run in PowerShell as Administrator for Task Scheduler registration):
#   irm https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/main/install.ps1 | iex
#
param(
    [string]$repo = "",
    [string]$dir  = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$GITHUB_BRANCH = "main"
$GITHUB_RAW    = "https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/$GITHUB_BRANCH"
$SERVICE_NAME  = "claude-sharing"
$LOG_DIR       = "$env:USERPROFILE\.claude-sharing"
$LOG_FILE      = "$LOG_DIR\daemon.log"

# ---- Install the package -------------------------------------------------------
Write-Host "==> Installing claude-sharing..."

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (Test-Path (Join-Path $scriptDir "pyproject.toml")) {
    pip install --quiet $scriptDir
} else {
    pip install --quiet "git+https://github.com/zacharyjleach-stack/CLAUDE-SHARING.git@$GITHUB_BRANCH"
}

$binary = (Get-Command claude-share -ErrorAction SilentlyContinue).Source
if (-not $binary) {
    # pip scripts land in the user Scripts dir — add it to PATH for this session
    $userScripts = "$env:APPDATA\Python\$(python -c 'import sys; print(f\"Python{sys.version_info.major}{sys.version_info.minor}\")')\Scripts"
    $env:PATH = "$userScripts;$env:PATH"
    $binary = (Get-Command claude-share -ErrorAction SilentlyContinue).Source
}

if (-not $binary) {
    Write-Error "claude-share not found on PATH after install. Make sure Python's Scripts directory is in your PATH."
    exit 1
}
Write-Host "    Installed: $binary"

# ---- Register as a background service (Windows Task Scheduler) -----------------
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null

$taskExists = Get-ScheduledTask -TaskName $SERVICE_NAME -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction -Execute $binary -Argument "start"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

if ($taskExists) {
    Set-ScheduledTask -TaskName $SERVICE_NAME -Action $action -Trigger $trigger -Settings $settings | Out-Null
    Write-Host "==> Background task updated (Task Scheduler)"
} else {
    Register-ScheduledTask -TaskName $SERVICE_NAME -Action $action -Trigger $trigger `
        -Settings $settings -RunLevel Limited -Force | Out-Null
    Write-Host "==> Background task registered (Task Scheduler)"
}

# Start it now without waiting for next logon
Start-ScheduledTask -TaskName $SERVICE_NAME
Write-Host "==> Background task started"

# ---- First-time project setup --------------------------------------------------
if ($repo -ne "") {
    Write-Host ""
    Write-Host "==> Running first-time setup for $dir ..."
    & claude-share setup --repo $repo --commit --dir $dir
}

# ---- Done ----------------------------------------------------------------------
Write-Host ""
if ($repo -ne "") {
    Write-Host "All done! Claude Code sessions in $dir will now sync automatically."
    Write-Host ""
    Write-Host "Share this with your teammates:"
    Write-Host ""
    Write-Host "  irm $GITHUB_RAW/install.ps1 | iex  # then fill in --repo"
    Write-Host "  # or clone the repo and run: .\install.ps1 --repo $repo"
    Write-Host ""
} else {
    Write-Host "Installed. Now run setup in your project directory:"
    Write-Host ""
    Write-Host "  # New dedicated repo:"
    Write-Host "  claude-share setup --repo https://github.com/your-org/shared-context.git --commit"
    Write-Host ""
    Write-Host "  # Or your existing team repo (uses an orphan 'claude-context' branch):"
    Write-Host "  claude-share setup --repo https://github.com/zacharyjleach-stack/CLAUDE-SHARING.git --commit"
    Write-Host ""
}
Write-Host "Logs: $LOG_FILE"
