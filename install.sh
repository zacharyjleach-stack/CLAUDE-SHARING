#!/usr/bin/env bash
# install.sh — install claude-sharing and set it up as a background service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="claude-sharing"

echo "==> Installing claude-sharing..."
pip install --quiet "$SCRIPT_DIR"

BINARY="$(command -v claude-share)"
echo "    Installed at: $BINARY"

# ---- macOS launchd -----------------------------------------------------------
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
    echo "==> Registered macOS LaunchAgent: $PLIST"
    echo "    Logs: ~/.claude-sharing/daemon.log"
    echo "    Stop:  launchctl unload $PLIST"
    echo "    Start: launchctl load -w $PLIST"

# ---- Linux systemd (user) ----------------------------------------------------
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
    echo "==> Registered systemd user service: $UNIT"
    echo "    Logs:   journalctl --user -u $SERVICE_NAME -f"
    echo "             or ~/.claude-sharing/daemon.log"
    echo "    Stop:   systemctl --user stop $SERVICE_NAME"
    echo "    Start:  systemctl --user start $SERVICE_NAME"
    echo "    Status: systemctl --user status $SERVICE_NAME"

# ---- Fallback: plain background process --------------------------------------
else
    LOG="$HOME/.claude-sharing/daemon.log"
    mkdir -p "$(dirname "$LOG")"
    nohup "$BINARY" start >> "$LOG" 2>&1 &
    echo $! > "$HOME/.claude-sharing/daemon.pid"
    echo "==> Started in background (PID $!)"
    echo "    Logs: $LOG"
    echo "    Stop: kill \$(cat ~/.claude-sharing/daemon.pid)"
fi

echo ""
echo "Next steps:"
echo "  1. Set the shared git repo (everyone uses the SAME URL):"
echo "       claude-share config --repo git@github.com:yourteam/claude-context.git"
echo ""
echo "  2. Add your project directories:"
echo "       claude-share watch --add ~/projects/my-api"
echo "       claude-share watch --add ~/projects/my-frontend"
echo ""
echo "  3. Check status at any time:"
echo "       claude-share status"
echo ""
echo "That's it. The daemon will keep CLAUDE.md files in sync automatically."
