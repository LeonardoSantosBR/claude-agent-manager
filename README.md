# Claude Agent Manager

One panel to drive several Claude Code agents at once: a sidebar with sessions
organized into groups, each agent's real terminal in the main area, and a switch
between Pro accounts (personal / work).

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
- Agents live on the **server**, not in the tab. Closing the browser, reloading,
  or opening from another machine on the network kills nothing — on reconnect the
  server replays the scrollback (512KB per session) and forces the TUI to redraw.
- **Groups** work like Postman collections: create a group (say `curiosity`) and
  hang as many sessions off it as you want. The `+` in a group header opens the
  modal with it preselected, and the group learns its folder from the first
  session dropped inside — the next ones come prefilled. Sessions can be dragged
  between groups, and deleting a group does **not** delete its sessions: they
  fall back to "No group".
- Nicknames, group, folder and account for each session live in
  `~/.config/claude-agent-manager/state.json` (override with
  `AGENT_MANAGER_STATE_DIR`). If the server goes down, sessions come back listed
  as stopped and the ▸ button resumes each one where it left off.
- The modal's **Browse** button opens the desktop folder picker through `zenity`
  (or `kdialog`) — the server spawns it, because the browser only hands back a
  relative path. That requires starting the manager from a terminal in your
  graphical session; without `DISPLAY`/`WAYLAND_DISPLAY` the button explains why
  and the text field still works.
- The **History** tab reads `<config-dir>/projects/*/<uuid>.jsonl` — the history
  Claude Code writes itself. Clicking an entry resumes that conversation.

## The two accounts

Accounts live in `~/.config/claude-agent-manager/accounts.json`, created on first
boot:

```json
[
  { "id": "personal", "label": "Personal", "configDir": "~/.claude",      "color": "#FF6C37" },
  { "id": "work",     "label": "Work",     "configDir": "~/.claude-work", "color": "#4EA1FF" }
]
```

Each session is born with `CLAUDE_CONFIG_DIR` pointing at the chosen account's
dir — and each dir has its own `.credentials.json`. You can have a personal
session and a work session running side by side, no logout/login dance.

To log in the second account, once:

```bash
CLAUDE_CONFIG_DIR=~/.claude-work claude   # then: /login
```

The sidebar shows a `!` on an account that isn't logged in.

**Important detail:** the account whose `configDir` is `~/.claude` runs *without*
the variable set. With `CLAUDE_CONFIG_DIR=~/.claude`, Claude Code starts looking
for `.claude.json` inside `~/.claude/` instead of `~/.claude.json`, and the
session comes up as a first run — no MCP servers, no project trust. See
`isDefaultConfigDir()` in [server/config.ts](server/config.ts).

Because the config dir is separate, `settings.json`, skills and plugins are
**not** shared between accounts. To mirror them, symlink:

```bash
ln -s ~/.claude/settings.json ~/.claude-work/settings.json
ln -s ~/.claude/skills        ~/.claude-work/skills
```

## Scripts

| script | what it does |
| --- | --- |
| `npm run dev` | server + web together |
| `npm run dev:server` | server only (5174) |
| `npm run dev:server:watch` | same with `--watch` — **restarts and kills the PTYs** on every save |
| `npm run build` | typecheck + front-end build |

## Layout

```
server/     sessions.ts (PTY + state)   history.ts (scans the .jsonl files)
            config.ts (accounts, binary) picker.ts (native folder dialog)
            index.ts (REST + websocket)
shared/     types.ts shared by both sides
src/        App.tsx, Sidebar, TerminalPane (xterm), NewSessionModal
```

Palette: background `#3c3c3c`, accent `#FF6C37`.
