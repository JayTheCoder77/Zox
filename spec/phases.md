# Delivery phases

Option **C** — TUI, headless server, and SDK share one OpenAPI contract; parallel tracks after contracts land.

## Phase 0 — Foundation (week 1–2)

**Exit criteria:** fake provider completes one turn over HTTP; SDK receives SSE deltas.

- [ ] Monorepo scaffold (Bun workspaces, TypeScript, `bun test`)
- [ ] `@zox/contracts` — Zod event schemas + OpenAPI stub
- [ ] `@zox/providers` — one real provider (OpenAI or Anthropic) + mock provider
- [ ] `@zox/core` — minimal loop (no tools)
- [ ] `@zox/server` — POST message, SSE events
- [ ] `@zox/sdk` — create session, send, stream
- [ ] CI: lint, test, typecheck

## Phase 1 — MVP harness (week 3–5)

**Exit criteria:** daily-usable local coding session with BYOK, tools, MCP, skills, slash commands.

- [ ] All BYOK providers listed in [providers.md](./providers.md)
- [ ] Tool registry: read, write, edit, bash, grep, glob, ls
- [ ] Permission gate + TUI approve/deny
- [ ] Token usage per turn + `/usage`
- [ ] Context estimation + manual `/compact`
- [ ] MCP stdio servers + `/mcp`
- [ ] Skills loader + `/skill`
- [ ] Slash table from [tools-extensibility.md](./tools-extensibility.md)
- [ ] CLI embedded server + `zox serve`
- [ ] TUI: transcript, input, status bar tokens
- [ ] SQLite session persistence
- [ ] Sandbox **worktree default** + tier 0 `host` opt-in; path jail + denylist + output caps ([sandbox.md](./sandbox.md))
- [ ] Hook runner: MVP eight events + example guards ([hooks.md](./hooks.md))
- [ ] OTel traces + basic Prometheus metrics ([observability.md](./observability.md))
- [ ] Plan memory via `todowrite` + persist `plan_json` ([memory.md](./memory.md))
- [ ] `SessionEnd` auto-summarize → `.zox/memory/auto/` (default on)

## Phase 1.5 — Agents and quality (week 6–7)

**Exit criteria:** plan/build switch; auto-compaction; SDK e2e test suite.

- [ ] `plan` agent profile
- [ ] Auto-compaction on overflow
- [ ] `webfetch`, `todowrite`
- [ ] Session resume + list
- [ ] SDK permission helpers + `waitForIdle`
- [ ] Contract tests vs OpenAPI
- [ ] `PreCompact` + `SessionStart(compact)` prior-state reinjection
- [ ] `budget.preCompactTokenThreshold` soft compaction
- [ ] Durable memory: auto-summarize tuning, `/remember`, FTS search, `memory_write` tool

## Phase 2 — OpenCode parity stretch (week 8+)

- [ ] Optional prune policy
- [ ] `task` subagent
- [ ] File snapshots + revert
- [ ] LSP: post-edit diagnostics (typescript first)
- [ ] WS channel for permissions
- [ ] Share/export session (redacted)
- [ ] Plugin slash commands
- [ ] Sandbox tier 2–3 (container, E2B/Daytona adapters)
- [ ] `zox agent run` + worktree lifecycle
- [ ] `zox eval` fixture harness (pass@1, turns/$, SWE-bench subset)
- [ ] Extended hook events (Permission*, PostToolBatch)
- [ ] Semantic code index (RAG lesson alignment)

## Parity matrix (tracking)

| Capability | OpenCode | Zox MVP | Zox 2 |
|------------|----------|---------|-------|
| Client/server | yes | yes | yes |
| TUI | yes | yes | yes |
| SDK | yes | yes | yes |
| BYOK | yes | yes | yes |
| MCP | yes | yes | OAuth |
| Skills | yes | yes | plugins |
| Slash commands | yes | yes | custom |
| Compaction | yes | manual | auto |
| Prune | yes | no | yes |
| LSP | yes | no | partial |
| Subagents | yes | no | yes |
| Snapshots/undo | yes | no | yes |
| Sandbox tiers | yes | worktree default | +remote |
| Hooks | yes | Zox hooks.json, 8 events | +extended events |
| OTel / metrics | partial | yes | +eval export |
| Durable memory | partial | plan + auto-summary | +RAG |

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Option C scope creep | Contract-first gate; mock server for TUI week 1 |
| Provider API drift | AI SDK + adapter tests per provider |
| Context bugs | Golden tests on assembly + compaction fixtures |
| MCP security | ask-by-default; document trust model |
| Sandbox false sense of security | Document worktree vs host; push tier 3 for autonomy |
| Worktree without git | Fallback to `host` with warning unless `requireGit: false` |
| Auto-summary noise | Rolling merge + user disable; pins via `/remember` |
| Hook command trust | `zox hooks trust` for project hooks |
| OTel PII leakage | `recordContent=false` default; hash prompts |

## Next step after spec approval

Invoke implementation planning: task breakdown per package, repo scaffold, and Phase 0 week-by-week checklist (separate `spec/implementation-plan.md` when ready).
