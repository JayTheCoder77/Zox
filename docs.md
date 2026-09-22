# Zox documentation

Companion to the [README](./README.md). This guide is written for first-time users and for people who will extend Zox. Formal product contracts live in [`spec/`](./spec/); when this file and a spec disagree on a **future** feature, trust the spec as intent and **the tests** as what ships.

---

## Contents

1. [What Zox is](#1-what-zox-is)
2. [Install and run](#2-install-and-run)
3. [First-session walkthrough](#3-first-session-walkthrough)
4. [Architecture](#4-architecture)
5. [CLI reference](#5-cli-reference)
6. [TUI and REPL](#6-tui-and-repl)
7. [Sessions](#7-sessions)
8. [Models and BYOK](#8-models-and-byok)
9. [Agents](#9-agents)
10. [Tools](#10-tools)
11. [Permissions](#11-permissions)
12. [Sandbox](#12-sandbox)
13. [Configuration](#13-configuration)
14. [Skills](#14-skills)
15. [Slash and project commands](#15-slash-and-project-commands)
16. [MCP](#16-mcp)
17. [Hooks](#17-hooks)
18. [Memory](#18-memory)
19. [Context, compaction, budgets](#19-context-compaction-budgets)
20. [Prompt guardrail (Jev)](#20-prompt-guardrail-jev)
21. [Server, OpenAPI, SDK](#21-server-openapi-sdk)
22. [Observability](#22-observability)
23. [Evals](#23-evals)
24. [Repository map](#24-repository-map)
25. [Troubleshooting](#25-troubleshooting)
26. [Glossary](#26-glossary)

---

## 1. What Zox is

Zox is a **coding agent harness**. An LLM does not magically “have a repo.” The harness:

- holds a **session** (messages, plan todos, usage);
- **assembles context** (system prompt, skills, memories, recent tools);
- **streams** the model;
- **executes tools** under policy;
- **recovers** when context is full (compaction, prior-state);
- **records** traces and metrics.

You bring **your own keys**. Zox is local-first: the server typically binds `127.0.0.1`. There is no Zox-hosted multi-tenant cloud in this codebase.

**Compared to a chat wrapper:** chat UIs send text and maybe a few function calls. Zox treats permissions, sandbox tiers, hooks, MCP, skills, and token budgets as first-class.

**Compared to Cursor / Claude Code / OpenCode:** the product goals overlap (terminal agent, tools, MCP). Zox’s hooks schema is **Zox-only** (`.zox/hooks.json`), not an import of another vendor’s settings file.

---

## 2. Install and run

### From npm (`zox-code`) — recommended

The published package is **[`zox-code` on npm](https://www.npmjs.com/package/zox-code)**. Install with Bun (the CLI bundle requires Bun ≥ 1.2):

```sh
bun add -g zox-code
zox --help

# no global install
bunx zox-code --sandbox host --model openai/gpt-4.1
```

The npm tarball ships a single bundled **`dist/cli.js`** (`#!/usr/bin/env bun`). Bin names: **`zox`** and **`zox-code`** (same program). Version on npm matches `packages/zox-code/package.json` in this repo.

**Not on npm:** `@zox/sdk` and other workspace packages. For automation against a running server, use HTTP/WebSocket per OpenAPI (`packages/server/openapi/openapi.yaml`) or clone this repo and import `@zox/sdk` from the monorepo (§21).

### From this repository (contributors)

Use **[Bun](https://bun.sh)** for install, tests, and running from source. Root `package.json` workspaces are `packages/*`. The registry tarball is built from `packages/zox-code`; day-to-day development uses TypeScript entrypoints under `packages/cli`.

```sh
git clone https://github.com/JayTheCoder77/Zox.git
cd Zox
bun install
bun test
bun run lint
bun run typecheck
bun run zox
bun run build:cli    # writes packages/zox-code/dist/cli.js (same artifact npm publishes)
```

### Running the CLI from source

Equivalent to the npm bins while hacking on Zox:

```sh
bun packages/cli/src/index.ts [flags] [subcommand]
# same as
bun run zox -- [flags] [subcommand]
```

Release maintainers publish with `bun run publish:cli` from the repo root (`prepublishOnly` runs the bundle build).

### Workspace vs Zox checkout

- **Zox checkout** — optional; only needed to develop Zox or use `@zox/sdk` from source.
- **Workspace** — the project the agent should edit (`--workspace`, default `cwd`).

Point the installed CLI at any directory (git recommended for default worktree sandbox):

```sh
cd /path/to/your/app
zox --workspace "$(pwd)" --model openai/gpt-4.1
```

---

## 3. First-session walkthrough

### 3.1 Keys

Export at least one provider key in the **same shell** that starts Zox (adapters are created from `process.env` at server start):

```sh
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY, GOOGLE_API_KEY / GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
```

Without keys you can still start a session with **`mock/echo`** (default model if config does not set one). The mock is for tests and plumbing, not real coding.

### 3.2 Start

```sh
cd /path/to/your/repo
zox --model openai/gpt-4.1
# or: bunx zox-code --model openai/gpt-4.1
```

If the project has `.zox/config.json` with a `model` field, you can omit `--model` on first launch.

Expect:

- An embedded server on **127.0.0.1:8787** (or `--port`).
- A random **bearer token** unless `ZOXX_SERVER_TOKEN` is set.
- TUI if stdin/stdout are TTYs and `--no-tui` is off.

### 3.3 Ask something small

Example: “List the top-level files and summarize README in two sentences.”

The model should call `ls` / `read`. **Read** tools are often allowed; **write** and **bash** typically prompt you.

### 3.4 Where did my files go?

If you did not pass `--sandbox host`, look under:

```text
.zox/worktrees/<sessionId>/
```

Review with `git` in that worktree, then merge or cherry-pick into your main tree. Use `--sandbox host` when you want the agent to touch the files already in your editor.

### 3.5 Stop

`/exit` or Ctrl+C. The embedded server stops with the TUI. Headless `zox serve` keeps running until you kill it.

---

## 4. Architecture

High-level flow:

```
TUI / REPL / @zox/sdk
        │
        ▼
  packages/server (Hono)
        │
        ├── packages/core      agent loop (runTurn)
        ├── packages/context   tokens, assembly, compact
        ├── packages/providers BYOK adapters (Vercel AI SDK)
        ├── packages/tools     built-in + MCP-namespaced tools
        ├── packages/sandbox   path jail, denylist, worktrees
        ├── packages/hooks     .zox/hooks.json runner
        ├── packages/judge     optional Jev prompt review
        ├── packages/session   SQLite
        ├── packages/memory    durable notes, auto-summaries
        ├── packages/mcp       stdio MCP pool
        ├── packages/skills    SKILL.md discovery
        └── packages/observability  OTel + Prometheus
```

**Rule:** `cli` and `sdk` talk to the **HTTP contract** (`@zox/contracts` + OpenAPI). They should not import agent-loop internals from `@zox/core`.

The loop (simplified):

```
queue user message
optional Jev review (human turns only)
UserPromptSubmit hooks
while not done:
  assemble context
  stream model
  if tool calls:
    permission → PreToolUse → sandbox → tool → PostToolUse
  else:
    finish turn (idle)
compaction / budgets as configured
```

Session status values include: `idle`, `running`, `compacting`, `awaiting_permission`, `error`.

---

## 5. CLI reference

Parsed in `packages/cli/src/index.ts` and `parse.ts`.

### 5.1 Interactive (default)

No subcommand → `runEmbed`: start or attach, then TUI or REPL.

```sh
zox
zox --model anthropic/claude-sonnet-4-20250514 --agent plan
zox --workspace ~/src/app --sandbox host
zox --url http://127.0.0.1:8787 --token "$ZOXX_SERVER_TOKEN"
zox --session sess_...
zox --no-tui --port 9000
```

Attach requires `--token` or `ZOXX_SERVER_TOKEN`.

### 5.2 `zox serve`

Headless server for CI, remote machines, or a second TUI.

```sh
zox serve --port 8787 --sandbox worktree
```

Stderr prints the token (if generated) and `http://127.0.0.1:<port>`. Bind is loopback.

### 5.3 `zox agent run`

One-shot: create a session, send `<task>`, wait, exit.

```sh
zox agent run /path/to/repo "Add a --dry-run flag to the CLI"
zox agent run . "Fix the failing test" --model openai/gpt-4.1 --auto-approve
```

Exit code **1** if the prompt is **denied** by the guardrail (or equivalent block). `--auto-approve` approves **tools**, not Jev prompt `ask`.

### 5.4 `zox export session`

```sh
zox export session <sessionId>
zox export session <sessionId> --include-memory
```

Exports are redaction-aware; do not assume secrets never appear in raw transcripts you copy by hand.

### 5.5 `zox hooks trust`

Project hooks only run if the project is **trusted**. This command records trust for the current `--workspace` (see hook loader in `packages/server`).

```sh
zox hooks trust --workspace .
```

### 5.6 Eval subcommands

See [§23](#23-evals).

### 5.7 Flags (all commands)

| Flag | Type | Notes |
|------|------|--------|
| `--model` | string | `provider/model` |
| `--agent` | string | e.g. `build`, `plan` |
| `--workspace` | path | Session root |
| `--sandbox` | enum | `host` `worktree` `container` `remote` |
| `--url` | URL | Skip embed; attach |
| `--token` | string | Bearer for server |
| `--port` | number | Default 8787 |
| `--session` | id | Resume |
| `--no-tui` | bool | REPL |
| `--include-memory` | bool | Export |
| `--keep-worktree` | bool | Agent-run lifecycle |
| `--auto-approve` | bool | Tool permissions only |
| `--max-turns` | number | Eval / agent-run |
| `--timeout-ms` | number | Eval |
| `--limit` | number | Bench subset size |
| `--k` / `--n-attempts` | number | Trial count |
| `--skip-eval` | bool | SWE-lite: write predictions only |
| `--instance-id` | string | Repeatable; SWE-lite |
| `--task` | string | Repeatable; Terminal-Bench |
| `--jobs-dir` | path | Terminal-Bench jobs |

Unknown `--flags` are ignored (not an error).

---

## 6. TUI and REPL

### TUI (`packages/tui`)

Ink 5 + React. Shows transcript, streaming deltas, tool cards, and a **permission dialog**.

- Tool permission: “Allow this tool?”
- Prompt permission (`prompt.permission_required`): “Submit this prompt anyway?”

Events such as `prompt.blocked` and `prompt.guardrail` with `skipped` surface as warnings in the UI.

### REPL (`packages/cli/src/repl.ts`)

Used when not a TTY, `--no-tui`, or TUI import fails. Line-oriented. Slash commands still work. Permissions use stdin y/n (`packages/cli/src/permission.ts`).

Non-interactive automation should use **`@zox/sdk`** and an explicit permission policy rather than hoping a human is at the keyboard.

---

## 7. Sessions

A session is scoped to a **workspace root** (and typically a git root for worktrees).

Create (interactive): starting `zox` without `--session`.  
Resume: `--session <id>`.  
Reset conversation in REPL/TUI: `/clear` (closes the session and opens a new one with the same defaults).

Persistence: SQLite via `@zox/session`. Message graph includes user, assistant, tool calls/results, system, compaction summaries.

Cancellation: `/cancel` or `POST /sessions/{id}/cancel`.

Export: `zox export session`.

---

## 8. Models and BYOK

Canonical id: **`<providerId>/<modelId>`**.

| Provider id | Env | Adapter |
|-------------|-----|---------|
| `anthropic` | `ANTHROPIC_API_KEY` | Anthropic |
| `openai` | `OPENAI_API_KEY` | OpenAI |
| `google` | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Google |
| `groq` | `GROQ_API_KEY` | OpenAI-compatible (`https://api.groq.com/openai/v1`) |
| `openrouter` | `OPENROUTER_API_KEY` | OpenAI-compatible (`https://openrouter.ai/api/v1`) |
| `mock` | none | `mock/echo` |
| custom | `providers.<id>.apiKeyEnv` | `kind`: `openai` `anthropic` `google` `openai-compatible` |

Resolution order for keys (see `spec/providers.md` and `packages/config/src/adapters.ts`):

1. Process environment (built-in names).
2. Extra `config.providers` entries if their env var is set.
3. Never persist raw keys in SQLite.

Custom local server example:

```json
{
  "providers": {
    "lmstudio": {
      "kind": "openai-compatible",
      "baseURL": "http://127.0.0.1:1234/v1",
      "apiKeyEnv": "LMSTUDIO_API_KEY"
    }
  }
}
```

Then `--model lmstudio/your-local-name`.

Switch mid-session: `/model anthropic/claude-sonnet-4-20250514`.

Usage: `/usage`, SSE `usage` events, SDK helpers. Estimated USD only if the catalog has prices.

---

## 9. Agents

MVP profiles (`spec/tools-extensibility.md`):

| Agent | Typical tools | Writes / bash |
|-------|----------------|---------------|
| `build` | Full built-in set | Permissioned (ask/allow) |
| `plan` | `read`, `grep`, `glob`, `ls`, `skill` | No write/bash |

Start with `--agent plan` for read-only exploration, then `/agent build` when you want edits.

---

## 10. Tools

Registered in `packages/tools` (`createBuiltinTools`).

| Tool | Role |
|------|------|
| `read` | File + optional line range |
| `write` | Create / overwrite |
| `edit` | Search-replace / patch-style |
| `bash` | Shell, cwd = sandbox root |
| `grep` | Ripgrep-style search |
| `glob` | Filename patterns |
| `ls` | Directory listing |
| `webfetch` | HTTP GET with size / host limits |
| `todowrite` | Full plan list rewrite (plan memory) |
| `skill` | Load a `SKILL.md` body |
| `memory_write` / `memory_search` | Durable memory |
| `code_search` | Repo search / index (BM25/FTS5; dense embeddings deferred) |
| `task` | Subagent turn (**skips Jev**; model-written prompt) |

MCP tools appear as namespaced entries (e.g. `mcp_<server>_<tool>`).

**Pipeline for mutating / subprocess tools:**

permission → verification/budget → PreToolUse → sandbox → implementation → PostToolUse → truncate observation for context.

Tool stdout is capped so a single `grep` cannot blow the window (see sandbox + context specs).

---

## 11. Permissions

Two different “asks”:

1. **Tool permission** — `tool.permission_required`. Should this `bash`/`write`/MCP call run? `--auto-approve` can answer yes.
2. **Prompt permission** — `prompt.permission_required`. Jev (or equivalent) is unsure about the **user prompt**. `--auto-approve` does **not** auto-yes this.

Ruleset idea (project policy; evaluation order **deny → allow list → default → ask**):

```json
{
  "bash": { "default": "ask", "allow": ["bun test", "git status*"] },
  "write": { "default": "ask" },
  "read": { "default": "allow" }
}
```

If nobody is listening for a permission request, the loop treats it like a denial (see core loop tests).

HTTP: `POST /sessions/{id}/permissions/{requestId}` with `{ "approved": true | false }` — used for **both** tool and prompt waits.

---

## 12. Sandbox

The sandbox is a **development guardrail**, not a hypervisor. Untrusted autonomy should use stronger isolation (container / remote tiers when those adapters are fully wired).

| Mode | Isolation | When to use |
|------|-----------|-------------|
| `worktree` | **Default.** Git worktree under `.zox/worktrees/<sessionId>` | Daily interactive coding; keep main tree clean |
| `host` | Path jail on the real workspace | You want the agent in your current files |
| `container` | Docker/Podman (tier 2; see spec) | CI / less trusted tasks |
| `remote` | E2B / Daytona-style (tier 3; see spec) | Stronger isolation |

Worktree lifecycle:

- Session start: `git worktree add` on a `zox/<sessionId>` branch (requires git).
- Session end: default **keep** the worktree (`sandbox.worktree.cleanup`: `keep` | `remove`).

Executor refusals (before spawn): executable denylist (`sudo`, `rm`, …), interpreter smuggling flags, shell metacharacters when not using a shell, **realpath** path jail (symlink escape resistant).

CLI: `zox --sandbox host` or `/sandbox host`.

---

## 13. Configuration

### 13.1 Files

| Path | Scope |
|------|--------|
| `~/.config/zox/config.json` | User |
| `<workspace>/.zox/config.json` | Project (overrides user) |

Loaded by `loadZoxConfig` (`packages/config/src/load.ts`). Deep-merge objects; later keys win. Then env overlay for `ZOXX_MEMORY_AUTO_SUMMARIZE`.

Unknown keys at the **root** of the schema may be stripped or rejected depending on Zod object mode; **`judge` is `strictObject`** — extra keys inside `judge` fail parse. Keep JSON valid.

### 13.2 Schema map

From `packages/config/src/schema.ts` (all optional unless you set them):

| Key | Purpose |
|-----|---------|
| `model` | Default `provider/id` |
| `agent` | Default profile |
| `instructions.files` | Extra instruction files for context |
| `sandbox.mode` | `host` / `worktree` / `container` / `remote` |
| `sandbox.worktree.cleanup` | `keep` / `remove` |
| `sandbox.envAllowlist` | Env vars allowed into tool processes |
| `sandbox.network.allowHosts` | Network allowlist |
| `context.windowTokens` | Context window size |
| `context.overflowThreshold` | Fraction that triggers overflow handling |
| `context.prune.*` | Optional prune policy |
| `budget.preCompactTokenThreshold` | Soft compact trigger |
| `budget.maxTurns` | Stop after N turns |
| `budget.maxUsdPerTask` | Spend cap |
| `memory.autoSummarize` | Default **on**; SessionEnd → `.zox/memory/auto/` |
| `memory.summarizeModel` | Model used for summaries |
| `memory.startupInjectCount` | How many memories at start |
| `memory.rollingSummary` | Rolling summary flag |
| `memory.autoInject` | Extra inject paths |
| `tools.webfetch.maxBytes` / `allowedHosts` | Web fetch limits |
| `skills.autoLoad` | Skill names loaded at start |
| `skills.loadPaths` | Extra skill directories |
| `skills.catalog*` | Catalog injection limits |
| `mcp.servers` | Stdio MCP map |
| `index.embeddings.apiKeyEnv` | Parsed, **ignored** (no dense embeddings yet) |
| `providers` | Extra / override provider specs |
| `judge` | Jev prompt guardrail |
| `observability` | OTel / metrics / `recordContent` |

### 13.3 Example project config

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "agent": "build",
  "sandbox": {
    "mode": "worktree",
    "worktree": { "cleanup": "keep" }
  },
  "budget": {
    "maxTurns": 80,
    "maxUsdPerTask": 5
  },
  "memory": {
    "autoSummarize": true
  },
  "skills": {
    "autoLoad": ["commit-helper"]
  },
  "mcp": {
    "servers": {
      "github": {
        "command": "bunx",
        "args": ["@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      }
    }
  },
  "observability": {
    "enabled": true,
    "recordContent": false
  }
}
```

`${GITHUB_TOKEN}` is expanded from the environment for MCP env values.

### 13.4 Environment variables

| Variable | Role |
|----------|------|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` | Provider keys |
| `ZOXX_SERVER_TOKEN` | Shared secret for HTTP (`zox serve` / attach) |
| `ZOXX_MEMORY_AUTO_SUMMARIZE` | `0`/`false` disables; `1`/`true` enables |
| `ZOXX_OBSERVABILITY` | `0` disables metrics path in server listen |
| `TYPESAFE_API_KEY` | Jev (or `judge.apiKeyEnv`) |

Note the **double X** in `ZOXX_*`.

---

## 14. Skills

Skills are Markdown playbooks (`SKILL.md`) the model can load.

**Discovery order:**

1. `.zox/skills/<name>/SKILL.md`
2. `~/.config/zox/skills/<name>/SKILL.md`
3. `skills.loadPaths[]`

Frontmatter:

```yaml
---
name: commit-helper
description: Conventional commits from diffs
---
```

**Activation:**

- `/skill commit-helper` — inject into session `activeSkills`.
- Model `skill` tool with `name`.
- `skills.autoLoad` on session start.

See `spec/skills.md` for catalog / unload / persist details (some Phase 1.5 items may still be in progress; check tests).

---

## 15. Slash and project commands

Built-in names (`packages/cli/src/parse.ts`):

`help` `model` `agent` `compact` `context` `usage` `clear` `mcp` `skill` `skills` `cancel` `sandbox` `trace` `remember` `revert` `exit`

`/mcp add <name> <command> [args…]` and `/mcp remove <name>` are handled in the CLI; other names go to `session.command` on the server.

**Project commands:** `.zox/commands/<name>.md`. Example (`examples/commands/explain.md`):

```markdown
Explain $ARGUMENTS in one sentence.
```

Typing `/explain the parser` expands to a user message. Same pattern as many other agent CLIs.

---

## 16. MCP

Configure under `mcp.servers`:

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "bunx",
        "args": ["@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      }
    }
  }
}
```

Runtime (`packages/mcp`): stdio transport, tools namespaced onto the registry. HTTP: `POST /mcp/servers`, `DELETE /mcp/servers/{name}`.

MCP write-like tools should still hit the permission gate.

---

## 17. Hooks

Policy without forking the harness. **Format is Zox-only:** `.zox/hooks.json` and optional `~/.config/zox/hooks.json`. Project hooks require **trust** (`zox hooks trust`).

### Events (MVP eight)

| Event | When | Can block? |
|-------|------|------------|
| `SessionStart` | Create/resume | Inject only |
| `UserPromptSubmit` | After Jev (if any), user message accepted | Yes |
| `PreToolUse` | Before tool | Yes |
| `PostToolUse` | After tool | No |
| `PreCompact` | Before compaction | Yes |
| `PostCompact` | After compaction | No |
| `Stop` | Model wants to end | Yes |
| `SessionEnd` | Close | No (auto-summarize memory) |

Command hooks: JSON on stdin, JSON on stdout (`decision`: `allow` | `deny` | `ask`). Exit **2** = deny. Other failures typically warn and continue.

Examples: `examples/hooks/` (`guard-destructive.sh`, `account-tokens.sh`, prior-state / reinject scripts).

Jev runs **before** `UserPromptSubmit` so hooks see prompts the user (or ask-flow) already allowed.

---

## 18. Memory

Do not mix these layers:

| Layer | Mechanism | Lifetime |
|-------|-----------|----------|
| Plan | `todowrite` full list | Session (protected in compact) |
| Working | Messages in the window | Turn / until compact |
| Prior-state | Compact recovery block | Session |
| Episodic | SQLite transcript | Durable audit |
| Durable | `.zox/memory/*.md`, `/remember`, `memory_write` | Cross-session |
| Semantic | Code index | FTS/BM25 today |

**Auto-summarize** (default on): on `SessionEnd`, write into `.zox/memory/auto/`. Disable with `"memory": { "autoSummarize": false }` or `ZOXX_MEMORY_AUTO_SUMMARIZE=0`.

`/remember` stores an explicit note. Startup can inject recent memories (`startupInjectCount`).

---

## 19. Context, compaction, budgets

The context engine estimates tokens, assembles the next request, and can compact when near the window.

- `/context` — breakdown.
- `/compact` — run compaction now.
- `budget.preCompactTokenThreshold` — soft mark (spec cites ~150k as a capstone example; set what fits your model).
- `budget.maxTurns` / `budget.maxUsdPerTask` — stop the loop.

Overflow: threshold × `windowTokens`. Optional **prune** of old tool bodies (protect plan, skills, recent errors). Details: `spec/context.md`.

---

## 20. Prompt guardrail (Jev)

Package: `@zox/judge`. Port: `PromptJudge` into `runTurn`.

**Off by default.** Enable:

```json
{
  "judge": {
    "enabled": true
  }
}
```

Plus `TYPESAFE_API_KEY` (or `judge.apiKeyEnv`).

Jev (TypeSafe System One) answers structured **noul** questions:

- **injection** — override system / tools / sandbox / hooks.
- **policy_violation** — user request vs the policy string (secret leak, crime, disable sandbox, …).

Scores `P(yes)` + `confidence` map to bands:

| Band | Default idea |
|------|----------------|
| deny | high yes **and** high confidence |
| ask | medium yes **and** medium confidence |
| allow | otherwise |

Defaults (`packages/judge/src/defaults.ts`): deny ≥ 0.85 yes and ≥ 0.7 confidence; ask ≥ 0.55 and ≥ 0.5. Tune with `judge.prompt.injection` / `policyViolation` (`denyMinYes`, `denyMinConfidence`, `askMinYes`, `askMinConfidence`).

**Fail-open:** missing key, timeout (`timeoutMs` default 2500), network, invalid JSON → `outcome: skipped`, warning, continue as allow. Prompts truncated to `maxPromptChars` (default 8000).

**Subagents:** `task` turns set `skipJudge` so model-written prompts are not treated as user injection.

Events: `prompt.guardrail`, `prompt.blocked`, `prompt.permission_required`.

Eval runner answers prompt-ask with **approved: false** (does not silently continue).

---

## 21. Server, OpenAPI, SDK

### Server

`packages/server` — Hono app. Representative routes (`spec/clients.md`):

| Method | Path |
|--------|------|
| POST | `/sessions` |
| GET | `/sessions/{id}` |
| POST | `/sessions/{id}/messages` |
| POST | `/sessions/{id}/cancel` |
| GET | `/sessions/{id}/events` (SSE) |
| WS | `/sessions/{id}/ws` |
| POST | `/sessions/{id}/permissions/{requestId}` |
| GET | `/models` |
| GET | `/usage` |
| GET/PUT | `/config` (redacted) |
| POST/DELETE | `/mcp/servers` |

Contract file: `packages/server/openapi/openapi.yaml`.

Auth: `Authorization: Bearer <token>`.

### SDK

**`@zox/sdk` is not published to npm** (only `zox-code` is). Use it from a clone of this repo (`bun install` in the monorepo), or call the HTTP/WebSocket API documented in `openapi.yaml` while `zox serve` (or an embedded session) is running.

```ts
import { createZoxClient } from "@zox/sdk";

const client = createZoxClient({
  baseUrl: "http://127.0.0.1:8787",
  token: process.env.ZOXX_SERVER_TOKEN!,
  // transport: "sse" | "ws"
});

const session = await client.sessions.create({
  workspaceRoot: "/path/to/app",
  agent: "build",
  model: "openai/gpt-4.1",
});

const run = session.send("Refactor the auth module");

run.onTool(async (event) => {
  if (
    event.type === "tool.permission_required" ||
    event.type === "prompt.permission_required"
  ) {
    await run.respondPermission(event.requestId, {
      approved: event.type === "tool.permission_required",
    });
  }
});

await run.waitForIdle();
```

`onTool` fires for `tool.started`, `tool.permission_required`, and `prompt.permission_required`.

---

## 22. Observability

`packages/observability`:

- OpenTelemetry GenAI-style spans (session → turn → model.call / tool.execute / hooks / compaction / judge).
- Prometheus metrics (including judge call counts and latency).
- **`recordContent` default false** — do not put full prompts in spans unless you opt in.

Config:

```json
{
  "observability": {
    "enabled": true,
    "serviceName": "zox",
    "recordContent": false,
    "otlp": {
      "endpoint": "http://127.0.0.1:4318/v1/traces"
    }
  }
}
```

`/trace` prints the last trace id for support. Redaction helpers strip common key patterns from logs (`OPENAI_API_KEY=…`, `ZOXX_SERVER_TOKEN=…`, etc.). Still: never paste production traces into public issues without review.

---

## 23. Evals

See also `eval/tasks/readme.md` and `spec/eval.md`.

### Fixture suite

YAML tasks with `expect.stdoutIncludes` and/or `expect.files`.

```sh
zox eval run                          # eval/tasks/mock + mock/echo
zox eval run eval/tasks/live --model openai/gpt-4.1
```

`--max-turns` (live default 50), `--timeout-ms` (default 300000), `--sandbox`.

### Private suite

`eval/private/<id>/`: `README.md` prompt, `repo/` start tree, hidden `tests/` + `grader.sh`. Agent never sees hidden tests. Default `k=3`.

```sh
zox eval private --model openai/gpt-4.1 --k 1
```

Artifacts: `eval/results/private/<task>/trial-N/`.

### SWE-bench Lite

Needs Docker and `swebench` in a venv. Real `--model` (not `mock/*`).

```sh
zox eval swe-lite --model openai/gpt-4.1 --limit 1
zox eval swe-lite --model openai/gpt-4.1 --skip-eval
```

### Terminal-Bench 2.0

Docker + Harbor. Adapter: `eval/adapters/harbor/zox_agent.py`.

```sh
zox eval terminal-bench --model openai/gpt-4.1 --limit 1
```

### Archive

```sh
zox eval archive
```

---

## 24. Repository map

```
Zox/
  README.md              Beginner onboarding
  docs.md                This guide
  spec/                  Product specification
  docs/superpowers/      Design notes and implementation plans
  packages/
    cli/ tui/ sdk/ server/
    core/ contracts/ config/
    providers/ tools/ sandbox/ hooks/ judge/
    context/ memory/ session/ mcp/ skills/ lsp/
    observability/
  eval/                  Tasks, private suite, benchmark glue
  examples/              Sample hooks and slash commands
```

`packages/lsp` exists for future diagnostics; full LSP fleet is a later phase (`spec/phases.md`).

---

## 25. Troubleshooting

**`zox: command not found` after `bun add -g zox-code`**  
Ensure Bun’s global bin directory is on your `PATH` (`bun pm bin -g`). Or skip a global install: `bunx zox-code …`.

**Nothing useful happens / echo-only replies**  
You are on `mock/echo`. Set a provider key and `--model`.

**Edits not in my editor**  
Default worktree. Open `.zox/worktrees/...` or restart with `--sandbox host`.

**Permission forever / hung `awaiting_permission`**  
Approve in TUI, or SDK `respondPermission`. `--auto-approve` for tools only. Headless eval will not approve prompt-level ask.

**`zox --url` fails**  
Need `--token` or `ZOXX_SERVER_TOKEN`. Server must still be running (`zox serve`).

**Hooks not running**  
Trust the project: `zox hooks trust`. Check `.zox/hooks.json` schema. Command hooks must print JSON.

**Jev never blocks**  
`judge.enabled` is false by default. If enabled but you see skip warnings, the API key or network failed (fail-open).

**MCP tools missing**  
Server process must have the command on PATH (`bunx`, `npx`, binaries). Env interpolation only fills `${VAR}` from the environment.

**`bun run lint` nested Biome config**  
Can happen with extra roots (for example leftover `.zox/worktrees`). Lint the packages you care about or clean worktrees.

**Typecheck / tests**  
Always `bun install` after pulling so workspace packages like `@zox/judge` link.

**Secrets in logs**  
Redaction is best-effort. Set `observability.recordContent: false`. Do not commit `.env` or paste keys into `/remember`.

---

## 26. Glossary

| Term | Meaning |
|------|---------|
| **Harness** | The loop + tools + policy around an LLM |
| **BYOK** | Bring your own key |
| **Session** | One workspace conversation with persisted state |
| **Turn** | One user message through to idle/error |
| **Worktree** | Git-linked extra checkout used as the jail root |
| **Band** | allow / ask / deny from Jev scores |
| **Fail-open** | On judge errors, continue the turn |
| **Noul** | Jev question type returning P(yes) + confidence |
| **MCP** | Model Context Protocol — extra tools via a server process |
| **Skill** | Markdown procedure injected or returned as a tool result |
| **Compaction** | Summarize old turns so the window fits |
| **Option C** | TUI + `zox serve` + SDK on one OpenAPI contract |

---

## See also

- [README.md](./README.md)
- [spec/README.md](./spec/README.md)
- [spec/architecture.md](./spec/architecture.md)
- [spec/clients.md](./spec/clients.md)
- [spec/sandbox.md](./spec/sandbox.md)
- [spec/hooks.md](./spec/hooks.md)
- [spec/providers.md](./spec/providers.md)
- [spec/tools-extensibility.md](./spec/tools-extensibility.md)
- [spec/skills.md](./spec/skills.md)
- [spec/memory.md](./spec/memory.md)
- [spec/context.md](./spec/context.md)
- [spec/observability.md](./spec/observability.md)
- [spec/eval.md](./spec/eval.md)
- [spec/phases.md](./spec/phases.md)
- [eval/tasks/readme.md](./eval/tasks/readme.md)
- [packages/server/openapi/openapi.yaml](./packages/server/openapi/openapi.yaml)
