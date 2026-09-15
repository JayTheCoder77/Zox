# Zox specification

Zox is a **Bun-first** monorepo and an npm-publishable coding agent harness (OpenCode-inspired): BYOK providers, strong context management, MCP, user skills, slash commands, and a client/server architecture with a terminal UI and programmatic SDK.

## Documents

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | System boundaries, packages, data flow, core subsystems |
| [clients.md](./clients.md) | TUI, CLI, `zox serve`, and `@zox/sdk` (option C) |
| [context.md](./context.md) | Context assembly, tokens, compaction, pruning |
| [providers.md](./providers.md) | BYOK, routing, streaming, usage accounting |
| [tools-extensibility.md](./tools-extensibility.md) | Built-in tools, MCP, skills, slash commands |
| [sandbox.md](./sandbox.md) | Sandbox tiers, path jail, denylist, observation limits |
| [hooks.md](./hooks.md) | Lifecycle hooks (PreToolUse, PreCompact, etc.) |
| [observability.md](./observability.md) | OpenTelemetry GenAI spans, Prometheus, budgets |
| [memory.md](./memory.md) | Plan state, prior-state, durable and semantic memory |
| [phases.md](./phases.md) | Delivery phases, milestones, and parity targets |

Inspired by [Capstone 01 — Terminal-Native Coding Agent](https://aiengineeringfromscratch.com/lesson?path=phases/19-capstone-projects/01-terminal-native-coding-agent) (plan–act–observe–recover, sandbox, hooks, OTel).

## Locked product decisions (v0.2)

| Topic | Decision |
|-------|----------|
| **Default sandbox** | `worktree` — each session edits in `.zox/worktrees/<sessionId>`; use `--sandbox host` to work directly on the checkout |
| **Hooks format** | **Zox-only** `.zox/hooks.json` schema (no Claude Code import); event names may resemble other harnesses but the contract is ours |
| **Durable memory** | **Auto-summarize** on `SessionEnd` into `.zox/memory/auto/` (on by default; disable with `memory.autoSummarize: false`) |

## Conventions

- **Runtime and toolchain:** [Bun](https://bun.sh) — `bun install`, `bun run`, `bun test`, `bun publish`, `bunx`; monorepo via `workspaces` in root `package.json`. No pnpm/npm CLI in the repo; releases go to the npm registry via **`bun publish`**.
- **Stable contracts** live in OpenAPI (`packages/server/openapi`) and TypeScript types shared via `@zox/contracts`.
- **Secrets** never persist in session DB or logs; config references env var names or keychain handles.
- **Server is source of truth** for sessions, permissions, and tool execution; clients are thin.

## Status

| Area | Status |
|------|--------|
| Architecture | Draft — v0.2 |
| Implementation | Phase 1 MVP landed |
