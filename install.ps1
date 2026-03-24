# install.ps1 — install claude-sharing on Windows (no admin required)
param(
    [string]$Repo = "",
    [string]$Branch = "main",
    [int]$Interval = 30
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------------------
# 1. Find Python
# ---------------------------------------------------------------------------
$PythonCmd = $null
foreach ($candidate in @("python", "python3", "py")) {
    try {
        $ver = & $candidate --version 2>&1
        if ($ver -match "Python 3") {
            $PythonCmd = $candidate
            break
        }
    } catch {}
}

if (-not $PythonCmd) {
    Write-Host ""
    Write-Host "ERROR: Python 3 was not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install it WITHOUT admin rights via the Microsoft Store:" -ForegroundColor Yellow
    Write-Host "  1. Press Start, search 'Microsoft Store'"
    Write-Host "  2. Search 'Python 3.12'"
    Write-Host "  3. Click Get / Install"
    Write-Host "  4. Once installed, close and reopen this terminal, then re-run this script."
    Write-Host ""
    exit 1
}

Write-Host "==> Using $PythonCmd ($(& $PythonCmd --version 2>&1))"

# ---------------------------------------------------------------------------
# 2. Ensure pip is available
# ---------------------------------------------------------------------------
try {
    & $PythonCmd -m pip --version | Out-Null
} catch {
    Write-Host "==> pip not found, bootstrapping..." -ForegroundColor Yellow
    & $PythonCmd -m ensurepip --upgrade
}

# ---------------------------------------------------------------------------
# 3. Install the package (user-level, no admin needed)
# ---------------------------------------------------------------------------
Write-Host "==> Installing claude-sharing..."
& $PythonCmd -m pip install --quiet --user $ScriptDir
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: pip install failed." -ForegroundColor Red; exit 1 }

# Find the installed binary
$UserScripts = & $PythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))"
$Binary = Join-Path $UserScripts "claude-share.exe"
if (-not (Test-Path $Binary)) {
    # Fallback: try Scripts in the Python dir
    $Binary = & $PythonCmd -c "import sys, os; print(os.path.join(os.path.dirname(sys.executable), 'Scripts', 'claude-share.exe'))"
}
Write-Host "    Installed at: $Binary"

# Add user Scripts dir to PATH for this session
$env:PATH = "$UserScripts;$env:PATH"

# Persist to user PATH (no admin needed)
$CurrentPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if ($CurrentPath -notlike "*$UserScripts*") {
    [System.Environment]::SetEnvironmentVariable("PATH", "$UserScripts;$CurrentPath", "User")
    Write-Host "    Added $UserScripts to your user PATH."
    Write-Host "    (Re-open terminal after install for PATH to take effect.)"
}

# ---------------------------------------------------------------------------
# 4. Apply config if --repo was passed
# ---------------------------------------------------------------------------
if ($Repo) {
    Write-Host "==> Configuring shared repo: $Repo"
    & $PythonCmd -m claude_sharing.cli config --repo $Repo --branch $Branch --interval $Interval
}

# ---------------------------------------------------------------------------
# 5. Register as a Windows Task Scheduler job (no admin, current user only)
# ---------------------------------------------------------------------------
$LogDir = "$env:USERPROFILE\.claude-sharing"
$LogFile = "$LogDir\daemon.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$TaskName = "ClaudeSharing"
$Action = New-ScheduledTaskAction `
    -Execute $Binary `
    -Argument "start" `
    -WorkingDirectory $env:USERPROFILE

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -RunLevel Limited `   # Limited = no admin
        -Force | Out-Null

    # Start it immediately
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "==> Registered Task Scheduler job: $TaskName"
    Write-Host "    Logs  : $LogFile"
    Write-Host "    Stop  : Stop-ScheduledTask -TaskName ClaudeSharing"
    Write-Host "    Start : Start-ScheduledTask -TaskName ClaudeSharing"
    Write-Host "    Remove: Unregister-ScheduledTask -TaskName ClaudeSharing -Confirm:`$false"
} catch {
    # Task Scheduler may be locked down — fall back to a simple shortcut in Startup folder
    Write-Host "    Task Scheduler unavailable, adding to Startup folder instead..." -ForegroundColor Yellow
    $StartupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("$StartupFolder\ClaudeSharing.lnk")
    $Shortcut.TargetPath = $Binary
    $Shortcut.Arguments = "start"
    $Shortcut.WindowStyle = 7  # Minimized
    $Shortcut.Save()
    Write-Host "    Added to Startup folder: $StartupFolder\ClaudeSharing.lnk"
    Write-Host "    Starting now..."
    Start-Process -FilePath $Binary -ArgumentList "start" -WindowStyle Hidden
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " claude-sharing is installed and running!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host ""
if (-not $Repo) {
    Write-Host "  1. Set the shared git repo (everyone uses the SAME URL):"
    Write-Host "       claude-share config --repo https://github.com/yourteam/claude-context.git"
    Write-Host ""
    Write-Host "  2. Add your project directories:"
} else {
    Write-Host "  1. Add your project directories:"
}
Write-Host "       claude-share watch --add C:\Users\$env:USERNAME\projects\my-api"
Write-Host "       claude-share watch --add C:\Users\$env:USERNAME\projects\my-frontend"
Write-Host ""
Write-Host "  Check status:  claude-share status"
Write-Host "  View logs:     Get-Content $LogFile -Wait"
Write-Host ""
