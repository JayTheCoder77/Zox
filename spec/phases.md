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

**Status:** landed (see `spec/README.md`).

- [x] All BYOK providers listed in [providers.md](./providers.md)
- [x] Tool registry: read, write, edit, bash, grep, glob, ls
- [x] Permission gate + TUI approve/deny
- [x] Token usage per turn + `/usage`
- [x] Context estimation + manual `/compact`
- [x] MCP stdio servers + `/mcp`
- [x] Skills loader + `/skill` + `skill` tool + `skills.autoLoad` (baseline — see [skills.md](./skills.md))
- [x] Slash table from [tools-extensibility.md](./tools-extensibility.md)
- [x] CLI embedded server + `zox serve`
- [x] TUI: transcript, input, status bar tokens
- [x] SQLite session persistence
- [x] Sandbox **worktree default** + tier 0 `host` opt-in; path jail + denylist + output caps ([sandbox.md](./sandbox.md))
- [x] Hook runner: MVP eight events + example guards ([hooks.md](./hooks.md))
- [x] OTel traces + basic Prometheus metrics ([observability.md](./observability.md))
- [x] Plan memory via `todowrite` + persist `plan_json` ([memory.md](./memory.md))
- [x] `plan` / `build` agent profiles
- [x] `SessionEnd` auto-summarize → `.zox/memory/auto/` (default on)

## Phase 1.5 — Agents and quality (week 6–7)

**Exit criteria:** plan/build workflows feel complete; auto-compaction; skills are first-class in the harness; SDK e2e test suite.

### Skills harness ([skills.md](./skills.md))

- [ ] Model-facing **skills catalog** (name + description index each session/turn)
- [ ] **`skill` tool activates skills** — same `activeSkills` state as `/skill`; `loadPaths` wired everywhere
- [ ] **`/skills`**, **`/skills reload`**, unload via **`/skill -u <name>`**
- [ ] **HTTP + SDK**: `GET /skills`, session skills get/load/unload; optional `skills.changed` SSE
- [ ] **Persist `activeSkills`** in SQLite; restore on session resume
- [ ] **TUI**: show active skills; list command output in transcript
- [ ] **`InstructionsLoaded` hook** + OTel `zox.skills.active`
- [ ] Protected skill content under future prune policy

### Other Phase 1.5

- [ ] Auto-compaction on overflow
- [ ] `webfetch`
- [ ] Session resume + list
- [ ] SDK permission helpers + `waitForIdle`
- [ ] Contract tests vs OpenAPI
- [ ] `PreCompact` + `SessionStart(compact)` prior-state reinjection (skills named in compact summary)
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
| Skills | yes | baseline load | catalog + tool parity + persist |
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
