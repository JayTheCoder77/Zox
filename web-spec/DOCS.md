# Docs

Docs are static MDX under `content/docs`. Layout: sticky sidebar + prose + optional right TOC.

---

## Navigation tree

```
Intro
  Overview
  Install
  Quickstart

Using Zox
  CLI reference
  TUI & REPL
  Sessions
  Models & BYOK
  Agents (build / plan)

Safety & tools
  Tools
  Permissions
  Sandbox
  Hooks
  Prompt guardrail (Jev)

Extensibility
  Configuration
  Skills
  Slash commands
  MCP

Advanced
  Architecture
  Server, OpenAPI & SDK
  Memory & context
  Observability
  Evals
  Troubleshooting
```

Map 1:1 to files under `content/docs/` (kebab-case). Nested groups only in the sidebar config — files can stay flat for simplicity.

---

## Page template

Each MDX page:

```mdx
---
title: Install
description: Install Zox with Bun and run your first session
---

# Install

…

## From npm

```sh
bun add -g zox-code
```

…

## Next

- [Quickstart](/docs/quickstart)
```

---

## Content guidelines

1. **Accuracy** — CLI flags, config keys, tool names must match `docs.md` / `README.md` in the Zox repo. When in doubt, quote the repo.
2. **Length** — Prefer focused pages (< ~400 lines). Link between topics.
3. **Code blocks** — Always language-tagged. Prefer `sh`, `json`, `ts`.
4. **No auth flows** — Nothing about login or cloud accounts.
5. **Local-first** — Emphasize worktree vs host, env keys, loopback server.

### Suggested page outlines

#### Overview (`index.mdx`)

- What Zox is / is not  
- Mental model (plan → act → observe → recover)  
- Surfaces: `zox`, `zox serve`, `@zox/sdk`  
- Link to install  

#### Install

- Bun requirement  
- Global vs `bunx`  
- Provider env vars table  
- Smoke with `mock/echo`  

#### Quickstart

- 10-minute first session (from README)  
- Worktree explanation  
- First permission prompt  

#### CLI reference

- Commands table (`zox`, `serve`, `agent run`, `export`, `hooks trust`, evals)  
- Global flags  
- In-session slash commands  

#### Configuration

- Merge order: user → project → env  
- Minimal `config.json`  
- Providers, sandbox, judge, memory  

#### Tools / Permissions / Sandbox / Hooks

- One page each; tables for tools and sandbox modes  
- Permission pipeline diagram in text  

#### Architecture

- Package map from monorepo  
- Server as source of truth  
- Link to `spec/` for locked decisions  

#### SDK

- Point at OpenAPI + `@zox/sdk`  
- Minimal client snippet  

#### Troubleshooting

- Common: no TTY, missing keys, worktree path, permission stuck  
- Link to GitHub issues  

---

## Docs chrome

### Sidebar

- Group labels (muted caption)  
- Active link: ink weight 500 + left hairline or underline  
- Mobile: collapse behind “Menu”  

### TOC (right, optional ≥ lg)

- Headings h2–h3 from current page  
- Scroll-spy  

### MDX components

- `CodeBlock` with copy  
- `Callout` (note / warning) — flat border, no icon required  
- `AsciiList` for `[+]` feature rows  
- Inline `code` uses surface-soft bg  

---

## Search (optional v1.1)

- Client-side index over titles + headings (Pagefind / FlexSearch)  
- No backend  

v1 can ship without search.