#!/usr/bin/env bash
# install.sh — install claude-sharing and optionally run first-time setup
#
# Usage (remote, one-liner):
#   curl -sSL https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/claude/shared-claude-workspace-PLU2e/install.sh | bash -s -- --repo git@github.com:your-org/shared-context.git
#
# Usage (local clone):
#   bash install.sh --repo git@github.com:your-org/shared-context.git
#
set -euo pipefail

REPO_URL=""
PROJECT_DIR="$(pwd)"

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) REPO_URL="$2"; shift 2 ;;
        --dir)  PROJECT_DIR="$2"; shift 2 ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

GITHUB="https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/claude/shared-claude-workspace-PLU2e"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-install.sh}")" 2>/dev/null && pwd || echo "")"
SERVICE_NAME="claude-sharing"

# ---- Install the package -------------------------------------------------------
echo "==> Installing claude-sharing..."

if [[ -f "$SCRIPT_DIR/pyproject.toml" ]]; then
    # Running from a local clone
    pip install --quiet "$SCRIPT_DIR"
else
    # Running via curl — install directly from GitHub
    pip install --quiet "git+https://github.com/zacharyjleach-stack/CLAUDE-SHARING.git@claude/shared-claude-workspace-PLU2e"
fi

BINARY="$(command -v claude-share)"
echo "    Installed: $BINARY"

# ---- Register as a background service ------------------------------------------
if [[ "$OSTYPE" == darwin* ]]; then
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST="$PLIST_DIR/${SERVICE_NAME}.plist"
    mkdir -p "$PLIST_DIR"

    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BINARY}</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/.claude-sharing/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.claude-sharing/daemon.log</string>
</dict>
</plist>
EOF

    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load -w "$PLIST"
    echo "==> Background service registered (macOS LaunchAgent)"

elif command -v systemctl &>/dev/null; then
    UNIT_DIR="$HOME/.config/systemd/user"
    UNIT="$UNIT_DIR/${SERVICE_NAME}.service"
    mkdir -p "$UNIT_DIR"

    cat > "$UNIT" <<EOF
[Unit]
Description=Claude Sharing Daemon
After=network.target

[Service]
ExecStart=${BINARY} start
Restart=on-failure
RestartSec=10
StandardOutput=append:%h/.claude-sharing/daemon.log
StandardError=append:%h/.claude-sharing/daemon.log

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable --now "$SERVICE_NAME"
    echo "==> Background service registered (systemd)"

else
    LOG="$HOME/.claude-sharing/daemon.log"
    mkdir -p "$(dirname "$LOG")"
    nohup "$BINARY" start >> "$LOG" 2>&1 &
    echo $! > "$HOME/.claude-sharing/daemon.pid"
    echo "==> Background service started (PID $!)"
fi

# ---- First-time project setup --------------------------------------------------
if [[ -n "$REPO_URL" ]]; then
    echo ""
    echo "==> Running first-time setup for $PROJECT_DIR ..."
    claude-share setup --repo "$REPO_URL" --commit --dir "$PROJECT_DIR" 2>/dev/null || \
    claude-share setup --repo "$REPO_URL" --dir "$PROJECT_DIR"
fi

# ---- Done ----------------------------------------------------------------------
echo ""
if [[ -n "$REPO_URL" ]]; then
    echo "All done! Claude Code web sessions in $PROJECT_DIR will now sync automatically."
    echo ""
    echo "Share this one-liner with your teammates:"
    echo ""
    echo "  curl -sSL ${GITHUB}/install.sh | bash -s -- --repo ${REPO_URL}"
    echo ""
else
    echo "Installed. Now run setup in your project directory:"
    echo ""
    echo "  claude-share setup --repo git@github.com:your-org/shared-context.git --commit"
    echo ""
fi
echo "Logs: ~/.claude-sharing/daemon.log"
