# Claude Agent Manager

Painel único pra tocar vários agentes do Claude Code ao mesmo tempo: sidebar com
as sessões agrupadas por projeto, terminal real de cada agente na área principal
e troca entre contas Pro (pessoal / empresa).

```
npm install
npm run dev     # sobe servidor (5174) + web (5173)
```

Abra http://localhost:5173.

## Como funciona

O React roda no browser e não spawna processo — quem faz isso é o servidor Node
ao lado:

```
browser (xterm.js) ──ws──▶ server/sessions.ts ──node-pty──▶ claude (TUI real)
```

- O REST (`/api`) passa pelo proxy do vite; os **websockets vão direto na 5174**.
  Pelo proxy, o volume do terminal estoura `EPIPE` toda vez que um painel
  desmonta no meio de uma escrita (StrictMode, HMR, reload). Ambas as portas são
  `strictPort` — se estiver ocupada, falha na cara em vez de trocar sozinha.
- Cada sessão é um `claude` de verdade num PTY, com `--session-id <uuid>` gerado
  aqui. O id é o mesmo que o Claude Code usa no histórico, então retomar é só
  `--resume <mesmo id>`.
- Os agentes vivem no **servidor**, não na aba. Fechar o browser, recarregar ou
  abrir em outra máquina da rede não mata ninguém — ao reconectar o servidor
  reenvia o scrollback (512KB por sessão) e força a TUI a se redesenhar.
- Apelidos, pasta e conta de cada sessão ficam em
  `~/.config/claude-agent-manager/state.json`. Se o servidor cair, as sessões
  voltam listadas como paradas e o botão ▸ retoma cada uma de onde parou.
- O botão **Procurar** do modal abre o seletor de pastas do desktop via `zenity`
  (ou `kdialog`) — quem spawna é o servidor, porque o browser só devolve caminho
  relativo. Isso exige que o manager seja iniciado pelo terminal da sua sessão
  gráfica; sem `DISPLAY`/`WAYLAND_DISPLAY` o botão explica o motivo e o campo de
  texto continua valendo.
- A aba **Histórico** lê `<config-dir>/projects/*/<uuid>.jsonl` — o histórico que
  o próprio Claude Code escreve. Clicar retoma a conversa.

## As duas contas

Contas ficam em `~/.config/claude-agent-manager/accounts.json`, criado no
primeiro boot:

```json
[
  { "id": "personal", "label": "Pessoal", "configDir": "~/.claude",      "color": "#FF6C37" },
  { "id": "work",     "label": "Empresa", "configDir": "~/.claude-work", "color": "#4EA1FF" }
]
```

Cada sessão nasce com `CLAUDE_CONFIG_DIR` apontando pro dir da conta escolhida —
e cada dir tem seu próprio `.credentials.json`. Dá pra ter uma sessão da conta
pessoal e outra da empresa rodando lado a lado, sem logout/login.

Pra logar a segunda conta, uma vez só:

```bash
CLAUDE_CONFIG_DIR=~/.claude-work claude   # depois: /login
```

A sidebar mostra `!` na conta sem login.

**Detalhe importante:** a conta cujo `configDir` é `~/.claude` roda *sem* a
variável setada. Com `CLAUDE_CONFIG_DIR=~/.claude`, o Claude Code passa a
procurar o `.claude.json` dentro de `~/.claude/` em vez de `~/.claude.json`, e a
sessão sobe como primeira execução — sem MCP servers, sem trust de projeto. Ver
`isDefaultConfigDir()` em [server/config.ts](server/config.ts).

Como o config dir é separado, `settings.json`, skills e plugins **não** são
compartilhados entre as contas. Se quiser os mesmos em ambas, symlink:

```bash
ln -s ~/.claude/settings.json ~/.claude-work/settings.json
ln -s ~/.claude/skills        ~/.claude-work/skills
```

## Scripts

| script | o que faz |
| --- | --- |
| `npm run dev` | servidor + web juntos |
| `npm run dev:server` | só o servidor (5174) |
| `npm run dev:server:watch` | idem com `--watch` — **reinicia e mata os PTYs** a cada save |
| `npm run build` | typecheck + build do front |

## Layout

```
server/     sessions.ts (PTY + estado)  history.ts (varre os .jsonl)
            config.ts (contas, binário)  index.ts (REST + websocket)
shared/     types.ts compartilhado entre os dois lados
src/        App.tsx, Sidebar, TerminalPane (xterm), NewSessionModal
```

Paleta: fundo `#3c3c3c`, destaque `#FF6C37`.
