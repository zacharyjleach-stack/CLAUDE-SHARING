# claude-sharing

A desktop app that pairs two teammates' Claude Code sessions in real time.
One person hosts a session and gets a short code; the other joins with that
code and a shared password. Once connected, each side's Claude Code activity
(file edits, commands run, messages) streams to the other's machine in the
background — so you can ask your own Claude Code CLI things like *"what has
Freddie just added?"* and it can answer, without you ever leaving your
terminal.

This replaces the earlier git-repo-polling CLI (`claude_sharing/`, `install.sh`),
which was unreliable. It's now two packages:

- **`apps/desktop`** — the Electron app you actually run. Handles pairing,
  the live peer-to-peer connection, and watching/syncing Claude Code
  transcripts for a chosen project folder.
- **`packages/mcp-server`** — a small MCP server the desktop app registers
  into your project's `.mcp.json`. It's how your Claude Code CLI reads what
  got synced — via tools, on demand, not by injecting anything into your
  context automatically.

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

## How the "what has Freddie added" part works

1. In the desktop app, each person picks the project folder they're working
   in ("Choose folder…"). The app:
   - starts tailing that project's Claude Code transcript
     (`~/.claude/projects/<sanitized-path>/*.jsonl`) and streams new lines to
     the connected peer, both as a compact "activity" summary (file edited,
     command run, message) and the full raw transcript line.
   - writes a `.mcp.json` in that folder registering the `claude-sharing`
     MCP server, so Claude Code picks it up automatically next session.
2. Incoming data from a teammate is written locally to
   `~/.claude-sharing/peers/<their-name>/{meta.json,activity.jsonl,transcript.jsonl}`.
3. The MCP server exposes three tools your Claude Code CLI can call:
   - `list_teammates` — who's paired and when they were last seen.
   - `get_teammate_activity` — recent compact activity for a teammate
     (what "what has Freddie just added" mostly needs).
   - `search_teammate_transcript` — full-text search over their synced
     transcript, for deeper "what did they say about X" questions.

**This costs you nothing in tokens just by being paired.** Nothing is
auto-injected into your Claude Code context — the sync happens entirely in
the background Electron process. Your Claude only touches this data when
you actually ask a question that makes it call one of the tools above, and
even then it only gets back the compact result of that one query.

## Installing

Both teammates just need to run one command. It clones the app to
`~/.claude-sharing/app`, installs and builds it, puts a `claude-sharing`
launcher on your PATH, and opens the app.

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/zacharyjleach-stack/CLAUDE-SHARING/main/install.sh | bash
```

**Windows (PowerShell):**

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

Requires [Node.js](https://nodejs.org) 18+ and `git` already installed —
everything else (Electron included) is pulled in automatically. Re-running
the same command later updates to the latest version. After that, just run:

```
claude-sharing
```

This isn't a signed/notarized installable `.app`/`.exe` yet (see
Limitations) — the one-liner runs it from source instead, which is why
Node/git are prerequisites.

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

- **Not tested end-to-end with two real machines** in this environment (no
  GUI/two-peer test harness available here) — the pairing handshake, IPC
  wiring, and transcript-derivation logic were built and unit-verified by
  compiling and smoke-running the app headlessly, but a live two-person
  pairing session hasn't been run. Try it and report back if the handshake
  or activity feed misbehaves.
- **No packaged installer.** `install.sh`/`install.ps1` give you a
  one-command install, but they run the app from source (need Node/git
  present) rather than installing a signed `.dmg`/`.exe`. Adding
  `electron-builder` packaging is straightforward follow-up work once the
  core flow is confirmed working.
- **One connection at a time.** Hosting supports a single joiner; group
  pairing isn't implemented.
- **Transcript-line parsing is best-effort.** Claude Code's `.jsonl` schema
  isn't a stable public API, so `deriveActivityEvent` falls back gracefully
  on shapes it doesn't recognize, but summaries may occasionally be generic.
- The `mcpServerEntryPath()` resolution in `apps/desktop/src/shared/paths.ts`
  assumes running from this source tree (`dist/main/... -> packages/mcp-server/dist`).
  Packaging as a standalone app will need that path bundled in
  differently (e.g. via `extraResources`).
