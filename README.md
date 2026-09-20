# Zox

Zox is a **local coding agent harness**: a program that talks to an LLM, lets that model use tools on your repo (read files, edit, run shell), and wraps every step in **permissions, sandboxing, sessions, and observability**.

It is **not** a hosted chat product. You bring your own API keys (BYOK). The agent loop lives in a server on your machine. The terminal UI and SDK are thin clients of that same server.

This README is for people who have never used an agent harness. The long-form reference is **[docs.md](./docs.md)**. The internal product spec is **[spec/](./spec/)**.

## Install (npm)

The published package name is **`zox-code`**. It requires [Bun](https://bun.sh) ≥ 1.2.

```sh
bun add -g zox-code
# or without a global install
bunx zox-code --model openai/gpt-4.1
```

That installs two bins: `zox` and `zox-code` (same CLI). Then:

```sh
export OPENAI_API_KEY=sk-...   # or ANTHROPIC_API_KEY, GOOGLE_API_KEY, …
cd /path/to/your/project
zox --model openai/gpt-4.1
```

Maintainers publish with `bun run publish:cli` (`bun publish` from `packages/zox-code` after bundling).

---

## What you get

| Surface | What it is |
|---------|------------|
| **`zox`** | Interactive terminal session (TUI if you have a TTY, otherwise a line REPL) |
| **`zox serve`** | Headless HTTP + SSE/WebSocket server |
| **`@zox/sdk`** | Typed client for scripts and other UIs |
| **Tools** | `read`, `write`, `edit`, `bash`, `grep`, `glob`, `ls`, `webfetch`, `todowrite`, `skill`, `memory_*`, `code_search`, `task` |
| **Safety** | Permission prompts, git **worktree** sandbox by default, path jail, hook policy |
| **Extensibility** | MCP servers, user skills, slash commands, `.zox/hooks.json` |

Inspired by the [Terminal-Native Coding Agent](https://aiengineeringfromscratch.com/lesson?path=phases/19-capstone-projects/01-terminal-native-coding-agent) pattern: **plan → act → observe → recover**.

---

## How it feels (mental model)

1. You type a request (“add a dry-run flag to the CLI”).
2. Optionally, a **prompt guardrail** (TypeSafe Jev) can allow, ask you, or deny that prompt. Off by default.
3. **UserPromptSubmit hooks** can rewrite or block the prompt (PII scrub, etc.).
4. The **model** streams a reply and may emit **tool calls**.
5. Each tool goes through **permission → PreToolUse hooks → sandbox → execute → PostToolUse**.
6. Tool results go back into the conversation. The loop repeats until the model stops or you cancel.
7. Usage, traces, and the transcript are stored for the **session**.

The **server is the source of truth**. The TUI does not run tools itself; it asks the server and renders events.

```
You (TUI / REPL / SDK)
        │  HTTP + SSE or WebSocket
        ▼
   Zox server  ──► LLM provider (Anthropic, OpenAI, …)
        │
        ├── tools (files, bash, MCP, …)
        ├── sandbox (worktree / host / …)
        ├── hooks
        └── SQLite session store
```

---

## Prerequisites

- **[Bun](https://bun.sh)** 1.x (install, test, and run everything with Bun — not npm/pnpm in this repo).
- A **git** checkout if you want the default **worktree** sandbox.
- An API key for at least one provider (or use `mock/echo` to smoke-test without a bill).

Clone and install:

```sh
git clone <this-repo>
cd Zox
bun install
```

Useful scripts from the repo root:

```sh
bun run zox          # start an interactive session in this workspace
bun test             # unit/integration tests
bun run lint
bun run typecheck
```

`bun run zox` is `bun packages/cli/src/index.ts`. Extra args go after `--`:

```sh
bun run zox -- --model anthropic/claude-sonnet-4-20250514 --sandbox host
```

---

## Ten-minute first session

### 1. Pick a model

Zox model IDs look like `provider/model`:

| Env var | Example `--model` |
|---------|-------------------|
| `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | `openai/gpt-4.1` |
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | `google/gemini-2.5-pro` |
| `GROQ_API_KEY` | `groq/llama-3.3-70b-versatile` |
| `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-3.5-sonnet` |

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

If you set **no** keys, you still have the built-in **`mock/echo`** provider (good for wiring tests, not for coding).

### 2. Start Zox in a project

```sh
cd /path/to/your/project
# from the Zox repo, or after you add the CLI to PATH
bun /path/to/Zox/packages/cli/src/index.ts --workspace "$(pwd)" --model anthropic/claude-sonnet-4-20250514
```

From inside the Zox repo, targeting this repo as the workspace:

```sh
bun run zox -- --model anthropic/claude-sonnet-4-20250514
```

- On a real terminal you get the **Ink TUI**.
- Piped / non-TTY sessions fall back to a **line REPL**.
- `--no-tui` forces the REPL.

### 3. Talk to it

Type a normal English task. Slash commands start with `/` (see below). Writes and shell usually **ask for permission** until you approve.

### 4. Understand the worktree

**Default sandbox is `worktree`.** Zox does **not** edit your current checkout in place. It:

1. Creates `.zox/worktrees/<sessionId>` with `git worktree`.
2. Runs file and shell tools **inside that tree**.
3. Leaves the worktree around by default so you can review and merge.

To edit the files you already have open in your editor:

```sh
bun run zox -- --sandbox host
```

---

## CLI cheat sheet

| Command | Purpose |
|---------|---------|
| `zox` | Embedded server + TUI/REPL |
| `zox --url http://127.0.0.1:8787 --token …` | Attach TUI to an existing server |
| `zox serve` | Headless server (prints token and URL on stderr) |
| `zox agent run <workspace> <task>` | One-shot task; exits non-zero if the prompt is blocked |
| `zox export session <id>` | Export a session (`--include-memory` optional) |
| `zox hooks trust` | Trust this project’s hooks |
| `zox eval run` | Fixture evals (default: mock tasks) |
| `zox eval private` | Hidden-grader private suite |
| `zox eval swe-lite` | SWE-bench Lite subset (Docker) |
| `zox eval terminal-bench` | Terminal-Bench 2.0 (Docker) |
| `zox eval archive` | Archive last eval artifacts |

### Global flags

| Flag | Meaning |
|------|---------|
| `--model <provider/id>` | Model for the session |
| `--agent build\|plan` | Tool/permission profile (`plan` is read-only tools) |
| `--workspace <dir>` | Project root |
| `--sandbox host\|worktree\|container\|remote` | Isolation tier |
| `--url` / `--token` | Connect to `zox serve` instead of embedding |
| `--port` | Bind port (default **8787**) |
| `--session <id>` | Resume a session |
| `--no-tui` | Line REPL |
| `--auto-approve` | Auto-allow **tool** permissions (never prompt-level `ask` from Jev) |
| `--keep-worktree` | Keep worktree after agent-run style jobs |
| `--max-turns` / `--timeout-ms` | Eval / agent-run limits |

### In-session slash commands

`/help` `/model` `/agent` `/compact` `/context` `/usage` `/clear` `/mcp` `/skill` `/skills` `/cancel` `/sandbox` `/trace` `/remember` `/revert` `/exit`

Project-defined commands: put Markdown templates in `.zox/commands/<name>.md` (see `examples/commands/explain.md`).

---

## Configuration

Zox merges JSON configs (later wins):

1. `~/.config/zox/config.json` (user)
2. `<workspace>/.zox/config.json` (project)
3. A few env overlays (for example `ZOXX_MEMORY_AUTO_SUMMARIZE`)

Providers are also **auto-detected from environment variables** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). You do not have to list them in JSON unless you want a custom `baseURL` or env var name.

Minimal project config:

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "agent": "build",
  "sandbox": { "mode": "worktree" }
}
```

**Secrets:** never put raw API keys in config or the session DB. Point at **env var names** (`apiKeyEnv`). Config can interpolate `${MY_VAR}` in MCP env blocks.

Full field list, hooks, MCP, skills, memory, observability, and the Jev guardrail: **[docs.md](./docs.md)**.

---

## Prompt guardrail (Jev)

Disabled by default. To run TypeSafe **Jev** on **human** prompts (not subagent `task` prompts), set `TYPESAFE_API_KEY` and:

```json
{
  "judge": {
    "enabled": true
  }
}
```

Outcomes: **allow** (continue), **ask** (you must confirm; `--auto-approve` does not skip this), **deny** (no model call). If the key is missing or Jev errors, the turn **continues** and the UI shows a skip warning (fail-open).

---

## Develop this repo

This is a **Bun workspace** monorepo (`packages/*`). Publish the CLI with:

```sh
bun run build:cli
bun run publish:cli
```

| Package | Role |
|---------|------|
| `contracts` | Zod events, OpenAPI-aligned types |
| `core` | Agent loop |
| `server` | Hono HTTP, SSE, WebSocket |
| `cli` / `tui` | User-facing terminal |
| `sdk` | Programmatic client |
| `providers` / `tools` / `sandbox` / `hooks` / `judge` | Harness pieces |
| `session` / `memory` / `context` / `observability` | Persistence and budgets |

Conventions: TypeScript, Biome, `bun test`. Clients should depend on **contracts + HTTP**, not `core` internals.

---

## Where to read next

1. **[docs.md](./docs.md)** — beginner-to-advanced user and developer guide (CLI, config, tools, safety, SDK, evals, troubleshooting).
2. **[spec/README.md](./spec/README.md)** — locked product decisions and subsystem specs (architecture, sandbox, hooks, providers, …).
3. **[eval/tasks/readme.md](./eval/tasks/readme.md)** — how fixture and private evals are scored.
4. **`packages/server/openapi/openapi.yaml`** — HTTP contract for `zox serve` and `@zox/sdk`.

---

## Status

Phase 1 MVP is landed (interactive harness, BYOK, tools, MCP, skills, worktree sandbox, hooks, OTel). Later phases add more skill-catalog polish, container/remote sandbox adapters, and extra clients. Treat `spec/phases.md` as the roadmap, and this repo’s tests as the source of truth for what actually runs today.
