#!/usr/bin/env bash
# One-liner installer for claude-sharing (macOS/Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/main/install.sh | bash
#
# Clones/updates the app into ~/.claude-sharing/app, installs + builds it,
# drops a `claude-sharing` launcher on your PATH, and opens the app.
set -euo pipefail

REPO_URL="https://github.com/zacharyjleach-stack/CLAUDE-SHARING.git"
APP_DIR="$HOME/.claude-sharing/app"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/claude-sharing"
REF="${CLAUDE_SHARING_REF:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required. Install it and re-run this script." >&2; exit 1; }; }
need git
need node
need npm

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "error: Node.js 18+ is required (found $(node -v)). Get it from https://nodejs.org" >&2
  exit 1
fi

echo "==> Installing claude-sharing to $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin --quiet
else
  git clone --quiet "$REPO_URL" "$APP_DIR"
fi
if [ -n "$REF" ]; then
  git -C "$APP_DIR" checkout --quiet "$REF"
  git -C "$APP_DIR" pull --quiet origin "$REF" || true
else
  git -C "$APP_DIR" pull --quiet
fi

echo "==> Installing dependencies (first run can take a minute)…"
(cd "$APP_DIR" && npm install --no-fund --no-audit --loglevel=error)

echo "==> Building…"
(cd "$APP_DIR" && npm run build --silent)

mkdir -p "$BIN_DIR"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
cd "$APP_DIR" && exec npm run start --silent --workspace apps/desktop
EOF
chmod +x "$LAUNCHER"

echo "==> Installed. Launcher: $LAUNCHER"
case ":${PATH:-}:" in
  *":$BIN_DIR:"*)
    ;;
  *)
    SHELL_RC="$HOME/.bashrc"
    [ -n "${ZSH_VERSION:-}" ] && SHELL_RC="$HOME/.zshrc"
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    echo "==> Added $BIN_DIR to PATH in $SHELL_RC (open a new terminal, or run: export PATH=\"$BIN_DIR:\$PATH\")"
    export PATH="$BIN_DIR:$PATH"
    ;;
esac

echo "==> Launching claude-sharing…"
"$LAUNCHER" >/dev/null 2>&1 &
disown || true

echo
echo "Done. Next time, just run: claude-sharing"
