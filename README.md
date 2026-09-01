# Claude Agent Manager

<img width="1006" height="394" alt="image" src="https://github.com/user-attachments/assets/1acb19fd-c47e-4011-a39a-254dbf848e2f" />


One panel to drive several Claude Code agents at once: a sidebar with sessions
organized into groups, each agent's real terminal in the main area, and the
logged-in Claude account at the bottom.

```
npm install
npm run dev     # starts the server (5174) + web (5173)
```

Open http://localhost:5173.

## How it works

React runs in the browser and can't spawn processes — the Node server next to it
does:

```
browser (xterm.js) ──ws──▶ server/sessions.ts ──node-pty──▶ claude (real TUI)
```

- REST (`/api`) goes through vite's proxy; **websockets talk straight to 5174**.
  Through the proxy, terminal throughput triggers `EPIPE` every time a pane
  unmounts mid-write (StrictMode, HMR, reload). Both ports use `strictPort` — if
  one is taken, it fails loudly instead of silently moving.
- Every session is a real `claude` in a PTY, with a `--session-id <uuid>`
  generated here. That id is the same one Claude Code uses in its history, so
  resuming is just `--resume <same id>`.
- Agents live on the **server**, not in the tab. Closing the browser, reloading
  or opening a second tab kills nothing — on reconnect the server replays the
  scrollback (512KB per session) and forces the TUI to redraw.
- **The server is loopback-only.** It listens on `127.0.0.1` and refuses any
  request or websocket whose `Origin` isn't localhost, because every endpoint
  here can start a `claude` in any folder on the machine, signed in as you —
  reachable from the network, that is remote code execution. `HOST=0.0.0.0`
  opens it up if you really mean to; put authentication in front of it first.
- **Groups** work like Postman collections: create a group (say `curiosity`) and
  hang as many sessions off it as you want. The `+` in a group header opens the
  modal with it preselected, and the group learns its folder from the first
  session dropped inside — the next ones come prefilled. Sessions can be dragged
  between groups, and deleting a group does **not** delete its sessions: they
  fall back to "No group".
- Nicknames, group and folder for each session live in
  `~/.config/claude-agent-manager/state.json` (override with
  `AGENT_MANAGER_STATE_DIR`). If the server goes down, sessions come back listed
  as stopped and the ▸ button resumes each one where it left off.
- **Restarting the server doesn't lose a session.** Two different things are
  saved: the conversation is Claude's own (`<config-dir>/projects/*.jsonl`), and
  the *rendered screen* is ours, in
  `~/.config/claude-agent-manager/scrollback/<id>.ansi` — throttled while running
  and flushed on `SIGINT`, so Ctrl+C keeps the last frame. Reopening a stopped
  session shows that frame plus a bar offering to resume, instead of a blank pane.
- Resume runs `claude --resume <id>`, **unless** that session never exchanged a
  message — Claude writes no `.jsonl` for those and `--resume` exits with
  "No conversation found". In that case it starts fresh under the same id
  (`hasSessionHistory()` in [server/history.ts](server/history.ts)).
- The modal's **Browse** button opens the desktop folder picker — the server
  spawns it, because the browser only hands back a relative path. The backend is
  picked per platform: a WinForms dialog through `powershell` on Windows,
  `osascript` on macOS, `zenity` (or `kdialog`) on Linux. On Linux that requires
  starting the manager from a terminal in your graphical session; without
  `DISPLAY`/`WAYLAND_DISPLAY` the button explains why and the text field still
  works.
- Sessions edit real files in their `cwd` — same filesystem your editor sees, and
  Claude's usual permission prompts show up inside the pane. They run in a plain
  PTY, so there's no VSCode integration by default; `/ide` inside a session
  connects it to a running editor window. Session-scoped `CLAUDE_CODE_*`
  variables from the parent shell are stripped before spawning
  (`INHERITED_SESSION_VARS` in [server/config.ts](server/config.ts)),
  otherwise agents launched from a Claude-owned terminal inherit another
  session's identity.
- The **History** tab reads `<config-dir>/projects/*/<uuid>.jsonl` — the history
  Claude Code writes itself. Clicking an entry resumes that conversation.

## The account

There is one login: the machine's own. The manager drives `~/.claude` and never
sets `CLAUDE_CONFIG_DIR` — with `CLAUDE_CONFIG_DIR=~/.claude`, Claude Code starts
looking for `.claude.json` *inside* `~/.claude/` instead of `~/.claude.json` and
comes up as a first run, without MCP servers or project trust. Leaving it unset
is what makes an agent opened here identical to a `claude` typed in a terminal.

The sidebar footer shows who that is — the email (and organization) from
`~/.claude.json`'s `oauthAccount`, shown only while `.credentials.json` exists.

- **Log in** runs `claude` in a hidden PTY, presses Enter past the theme and
  login-method menus, scrapes the OAuth URL it prints and opens it in the browser
  you already have the manager open in. Paste the code the browser gives back and
  the same waiting CLI receives it. The URL is also shown as a link, for when the
  pop-up blocker gets in the way. See [server/auth.ts](server/auth.ts).
- **Log out** deletes `~/.claude/.credentials.json` — the same thing `/logout`
  does inside Claude Code.
- Logging in from any terminal works just as well: the footer re-reads the files
  on every poll of `/api/auth`.

## Scripts

| script | what it does |
| --- | --- |
| `npm run dev` | server + web together |
| `npm run dev:server` | server only (5174) |
| `npm run dev:server:watch` | same with `--watch` — **restarts and kills the PTYs** on every save |
| `npm run build` | typecheck + front-end build |
| `npm test` | vitest in watch mode |
| `npm run test:run` | vitest once — what CI runs |

The tests cover the server's pure-ish edges, where the bugs actually were: the
origin gate, the state file (including the legacy array format), scrollback
throttling and capping, paste pruning, and the `.jsonl` history scan. They run
against a temp `AGENT_MANAGER_STATE_DIR`, so a test run never touches your real
sessions. `.github/workflows/ci.yml` runs typecheck, lint, tests and build on
Linux and Windows — Windows because that's where every PTY quirk in here lives.

## Layout

```
server/     sessions.ts (PTY + state)   history.ts (scans the .jsonl files)
            config.ts (paths, env)      picker.ts (native folder dialog)
            auth.ts (login flow)        index.ts (REST + websocket)
shared/     types.ts shared by both sides
src/        App.tsx, Sidebar, TerminalPane (xterm), NewSessionModal, LoginModal
tests/      vitest, server side only
```

Palette: background `#3c3c3c`, accent `#FF6C37`.
