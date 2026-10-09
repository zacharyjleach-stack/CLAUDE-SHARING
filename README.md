# claude-sharing

A desktop "party" app for pairing two teammates working on the same repo.
One person hosts and gets a short code (like a Zoom code); the other joins
with that code and a shared password. Once connected:

- Each side's Claude activity streams to the other **live** — including
  prompts typed into **claude.ai/code in the browser** (via a small
  companion browser extension), not just a local CLI.
- The app detects when you're both pointed at the **same GitHub repo** and
  flags it, so the live feed is obviously relevant instead of noise from
  unrelated projects.
- The window is a small floating widget — draggable, resizable, snappable
  to half-screen, pinnable always-on-top — meant to sit alongside your
  editor/browser rather than take over the screen.
- Your own Claude Code CLI can also query a teammate's synced activity
  on demand (`"what has Freddie just added?"`) via an MCP server, with
  zero ongoing token cost — nothing is auto-injected into your context.

This is the second rebuild of this tool. It replaced an earlier
git-repo-polling CLI, then added the pairing/MCP pieces below, and now adds
the browser extension + repo-awareness + floating-widget layer on top. Three
packages:

- **`apps/desktop`** — the Electron app you run. Pairing, the live
  peer-to-peer connection, the local bridge the browser extension talks to,
  repo-match detection, and (optionally) watching/syncing a local Claude
  Code CLI transcript for a chosen project folder.
- **`extension/`** — an unpacked browser extension for claude.ai. Watches
  your own `claude.ai/code` tab (the prompt box, and a best-effort "Claude's
  responding" signal) and relays it to the desktop app on `127.0.0.1` only.
- **`packages/mcp-server`** — a small MCP server the desktop app registers
  into your project's `.mcp.json`, giving your Claude Code CLI on-demand
  tools to read what got synced.

## How pairing works

There's no server run by us. The two apps connect directly over WebRTC
(peer-to-peer); a public PeerJS broker is used only to exchange the initial
connection offer (the equivalent of a phone book), never to relay any of
your data. Concretely:

1. Host clicks **Host**, sets a password, and gets a 6-character code.
2. They share the code + password with their teammate out of band (Slack, in
   person, whatever).
3. Teammate clicks **Join**, enters the code + password.
4. The app derives a shared key from `code + password` (PBKDF2) and runs a
   challenge/response handshake over the data channel before either side
   accepts any activity data — so knowing the code alone isn't enough to
   join, and the password itself is never transmitted.
5. From then on, everything flows directly between the two machines over
   the WebRTC data channel (DTLS-encrypted).

## Watching claude.ai/code (the browser extension)

1. Load `extension/` as an unpacked extension (see Installing below).
2. It injects a content script into `claude.ai/*` that:
   - captures the text you submit (Enter, or clicking the send button) and
     sends it to the desktop app as a prompt event,
   - watches for bursts of new DOM content shortly after a prompt as a
     best-effort "Claude is responding…" signal,
   - guesses the current repo from the page (title/headers matching
     `owner/repo`), overridable via the extension's popup if the guess is
     wrong,
   - shows a small in-page overlay when your teammate does something, with
     a **"Mention to Claude"** button that fills your prompt box with it —
     it never auto-submits, you stay in control of what your Claude sees.
3. All of this talks to the desktop app over `ws://127.0.0.1:8347` —
   loopback only, nothing leaves your machine except what then gets relayed
   to your *paired* teammate over the encrypted WebRTC link.

**Claude.ai's page structure isn't a published API**, so the selectors in
`extension/content.js` are best-effort heuristics (see comments at the top
of that file). If prompts or activity aren't being picked up, open devtools
on a `claude.ai/code` tab, find the real selector for the prompt box or
message list, and adjust `COMPOSER_SELECTORS` / the mutation observer
target. Also note: Chrome kills MV3 extension service workers after ~30s
idle, which drops the socket — a periodic alarm reconnects it, so this is
"near-real-time, self-healing within ~30s," not a guaranteed persistent
stream.

## Repo matching

Whichever source you use — the extension's guess/override, or the local
project folder you pick for the CLI path — the desktop app compares your
current repo to your teammate's and shows a banner when they match
(`apps/desktop/src/main/claude/repo.ts` normalizes GitHub remote URLs to
`owner/repo`). Teammate activity is still relayed either way, but the
banner (and the extension's in-page overlay) make it obvious when you're
actually looking at the same codebase.

## The floating widget window

The window is frameless and resizable; use the title bar buttons (or drag
any edge) to: snap to compact size, snap half-left/half-right on your
screen, go back to normal size, or pin it always-on-top. It's deliberately
small so it can sit next to your editor or browser instead of covering it.

## How "what has Freddie added" works (Claude Code CLI path)

1. In the desktop app, pick a project folder ("Choose folder…"). The app
   tails that project's local Claude Code CLI transcript
   (`~/.claude/projects/<sanitized-path>/*.jsonl`) and streams new lines to
   the connected peer, and writes a `.mcp.json` there registering the
   `claude-sharing` MCP server.
2. Incoming data (from either the CLI path above or the browser extension)
   is written locally to
   `~/.claude-sharing/peers/<their-name>/{meta.json,activity.jsonl,transcript.jsonl}`.
3. The MCP server exposes three tools your Claude Code CLI can call:
   - `list_teammates` — who's paired and when they were last seen.
   - `get_teammate_activity` — recent compact activity for a teammate
     (what "what has Freddie just added" mostly needs).
   - `search_teammate_transcript` — full-text search over their synced
     transcript, for deeper "what did they say about X" questions.

**This costs you nothing in tokens just by being paired.** Nothing is
auto-injected into your Claude Code context — the sync happens entirely in
the background Electron process/browser extension. Your Claude only
touches this data when you actually ask a question that makes it call one
of the tools above, and even then it only gets back the compact result of
that one query.

## Installing

### Option A: real installer (no Node/git needed)

Every push of a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which
builds a real installer on each OS's own runner and attaches them to a
GitHub Release: a `.AppImage` (Linux), `.dmg` (macOS), and `.exe` (Windows,
NSIS). Grab yours from the repo's **Releases** page and run it — no Node,
no git, no terminal. These are **unsigned** (no Apple notarization or
Windows code-signing cert), so macOS Gatekeeper / Windows SmartScreen will
warn on first launch; you'll need to click through ("Open anyway" /
"Run anyway").

Only the Linux `.AppImage` has actually been run and verified (see
Limitations) — the `.dmg`/`.exe` build in CI the same way but haven't been
launched on a real Mac/Windows machine yet.

### Option B: one-line script (runs from source, needs Node + git)

```bash
curl -fsSL https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/main/install.ps1 | iex
```

> **Before this branch is merged to `main`**, those URLs 404 — use the
> branch-pinned versions instead (swap to the ones above once merged):
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/claude/whats-in-this-rgdhod/install.sh | CLAUDE_SHARING_REF=claude/whats-in-this-rgdhod bash
> ```
> ```powershell
> $env:CLAUDE_SHARING_REF="claude/whats-in-this-rgdhod"; irm https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/claude/whats-in-this-rgdhod/install.ps1 | iex
> ```

Clones to `~/.claude-sharing/app`, builds, puts a `claude-sharing` launcher
on PATH, and opens the app. Re-run the same command later to update. After
that, just run `claude-sharing`.

### Loading the browser extension

Chrome needs a plain folder on disk for "Load unpacked" — the easiest
source for that regardless of which option above you used is the repo
itself: either `git clone` it, or use GitHub's **Code → Download ZIP** and
unzip it (no git needed for that route).

1. Chrome → `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select that checkout/unzip's `extension/` folder.
3. Open a `claude.ai/code` tab — the extension's popup should show
   "Connected to desktop app" once the desktop app is running.

(If you used Option A, the installer also carries its own copy inside
`resources/extension` next to wherever it installed, for reference — but
downloading the repo folder is the simplest way to actually point Chrome
at it.)

## Building installers yourself

```bash
npm install
npm run build
cd apps/desktop
npx electron-builder --publish=never   # or --linux / --mac / --win
```

`apps/desktop/src/main/index.ts` and `renderer.ts` get bundled by esbuild
(`apps/desktop/build.mjs`) into single self-contained files with no
`node_modules` needed at runtime — same for the MCP server
(`packages/mcp-server/build.mjs`). That's deliberate: electron-builder's
automatic "install production dependencies" step doesn't play well with
npm workspaces' hoisted `node_modules` (it can end up pruning
devDependencies — including itself — from the shared root tree). Bundling
sidesteps the problem entirely rather than fighting it; the one remaining
workaround needed is creating an empty `apps/desktop/node_modules`
directory before running electron-builder (already in the `package` npm
script and the CI workflow) so it takes the no-op "rebuild" path instead
of the destructive "install" one.

## Security notes

- The session **code** is effectively public (it's how peers rendezvous via
  the PeerJS broker) — the **password** is the actual secret and is never
  sent over the wire; only an HMAC proof of knowing it is exchanged.
- Transcript sharing is **full**, by design (you chose this): your teammate's
  Claude sees your complete conversation and tool calls for the folder you
  share, and vice versa. Don't pair on a project folder with secrets you
  don't want a teammate's Claude to be able to read/search.
- `nodeIntegration` is enabled in the renderer (no `contextIsolation`/preload
  bridge). That's a deliberate simplification for this fully-local, no
  remote-content-loaded app — it lets the UI drive WebRTC (`peerjs`) and the
  filesystem directly. Don't repurpose this window to load remote URLs.

## Known limitations / not yet done

- **There is no API for watching someone else's claude.ai session.** The
  extension only ever reads *your own* authenticated tab — "connecting to
  Claude web" means your browser mirrors your own activity to your own
  desktop app, which relays it to your teammate's. There's no mechanism
  (and shouldn't be one) for reading another account's session directly.
- **Not tested end-to-end with two real machines** in this environment (no
  GUI/two-peer test harness, and no live claude.ai session, available
  here). What *is* verified: both workspaces + the extension's manifest
  build/load correctly; the real, packaged Linux `.AppImage` (not just
  `electron .` from source) launches headlessly without error and its
  local WebSocket bridge on `127.0.0.1:8347` round-trips a real message
  from an external client. The WebRTC pairing handshake and the
  extension's DOM heuristics on a live claude.ai page have not been
  exercised end-to-end — try them and report back.
- **Extension selectors are best-effort**, per the section above — likely
  the single biggest thing to iterate on once tried against the real page.
- **Installers are unsigned.** No Apple notarization or Windows
  code-signing certificate, so Gatekeeper/SmartScreen will warn on first
  run (see Installing). Getting a cert and wiring up signing in CI is
  follow-up work.
- **Only the Linux `.AppImage` has actually been launched and verified**
  (see the bullet above) — the `.dmg`/`.exe` build successfully in CI but
  haven't been run on a real Mac/Windows machine.
- **The browser extension still needs manually loading as "unpacked"** —
  Chrome Web Store review is a separate, slower path not done here.
- **One connection at a time.** Hosting supports a single joiner; group
  pairing ("party" with 3+) isn't implemented.
- **Repo matching only recognizes GitHub remotes** (`repo.ts`), normalized
  from `git remote get-url origin` or the extension's page-guess/override.
  GitLab/Bitbucket/etc. aren't matched.
- **Transcript-line parsing is best-effort.** Claude Code's `.jsonl` schema
  isn't a stable public API, so `deriveActivityEvent` falls back gracefully
  on shapes it doesn't recognize, but summaries may occasionally be generic.
