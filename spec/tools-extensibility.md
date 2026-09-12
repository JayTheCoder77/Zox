# Tools, MCP, skills, and slash commands

## Tool registry

Central registry in `packages/tools` loaded by server at startup.

### Built-in tools (MVP)

| Tool | Agent default | Description |
|------|---------------|-------------|
| `read` | all | Read file with line range |
| `write` | build | Create/overwrite file |
| `edit` | build | Search/replace or patch-style edit |
| `bash` | build | Shell with cwd = workspace |
| `grep` | all | Ripgrep wrapper |
| `glob` | all | File pattern search |
| `ls` | all | Directory listing |
| `webfetch` | build | HTTP GET with size cap |
| `todowrite` | all | **Plan memory** — full list rewrite each call (capstone) |
| `skill` | all | Load and apply user skill |

### Later tools

| Tool | Phase |
|------|-------|
| `memory_write` / `memory_search` | V1.5 |
| `task` (subagent) | V1.5 |
| `question` | V1.5 (client-gated) |
| `apply_patch` | V1.5 |
| `invalid` | internal — model error recovery |

Tool descriptions live in co-located `.txt` files (OpenCode pattern) for easy diffing.

### Execution pipeline

All mutating and subprocess tools: **permission → verification gate → [PreToolUse hooks](./hooks.md) → [sandbox](./sandbox.md) → tool → PostToolUse → observation truncate**.

## MCP (`packages/mcp`)

### Configuration

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      }
    }
  }
}
```

### Runtime

- Spawn stdio transports per server; pool connections per session or global (config).
- Namespace tools: `mcp_github_create_issue`.
- Refresh tool list on server connect; hot-reload on `POST /mcp/servers`.
- OAuth flows (V2): delegate to MCP SDK patterns; store tokens in keychain.

### Permissions

- MCP tools inherit agent ruleset; default `ask` for write-like tools.
- User can set `mcp.servers.<name>.permission: allow|ask|deny` per tool pattern.

## Skills (`packages/skills`)

### Discovery paths (order)

1. `.zox/skills/<name>/SKILL.md`
2. `~/.config/zox/skills/<name>/SKILL.md`
3. Paths from config `skills.loadPaths[]`

### Format

Markdown with optional YAML frontmatter:

```yaml
---
name: commit-helper
description: Conventional commits from diffs
---
# Commit helper
...
```

### Activation

- **Slash:** `/skill commit-helper` injects skill into session state.
- **Tool:** model calls `skill` with `name` argument.
- **Auto:** config `skills.autoLoad[]` on session start.

Skills marked **protected** from prune (see [context.md](./context.md)).

## Slash commands

Parsed when user input starts with `/` in TUI/REPL; also available via SDK `session.command(name, args)`.

### Core commands (MVP)

| Command | Args | Action |
|---------|------|--------|
| `/help` | | List commands |
| `/model` | `<provider/model>` | Switch model |
| `/agent` | `build\|plan` | Switch agent profile |
| `/compact` | | Run compaction |
| `/context` | | Token breakdown |
| `/usage` | | Usage stats |
| `/clear` | | New session |
| `/mcp` | `list\|add\|remove` | MCP management |
| `/skill` | `<name>` | Load skill |
| `/cancel` | | Cancel current turn |
| `/sandbox` | `worktree\|host\|…` | Set sandbox tier (default `worktree`) |
| `/trace` | | Last OTel trace id |
| `/exit` | | Quit CLI |

### Extension

- Project commands: `.zox/commands/<name>.md` with template expanded into user message.
- Plugins (V2): register slash handlers via JS module `zox.config.js`.

## Permissions

Ruleset format (JSON):

```json
{
  "bash": { "default": "ask", "allow": ["npm test", "git status*"] },
  "write": { "default": "ask" },
  "read": { "default": "allow" }
}
```

Evaluation order: deny → allow list → default → ask.

## Agent profiles (MVP)

| Agent | Tools | Permissions |
|-------|-------|-------------|
| `build` | full MVP set | writes/shell ask or allow per config |
| `plan` | read, grep, glob, ls, skill | no write/bash |

Custom agents via config `agents.custom[]` merging prompts and rulesets.
