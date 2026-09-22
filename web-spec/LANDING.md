# Landing page

Mirror the structure and tone of [opencode.ai](https://opencode.ai/): sparse, terminal-coded, one strong visual (animated TUI mock).

---

## Header

```
[zox]          Docs    GitHub              [Download]
```

- Wordmark: lowercase `zox` in mono, pixel/block optional (optional ASCII grid).
- Links: Docs → `/docs`, GitHub → `https://github.com/JayTheCoder77/Zox`.
- CTA: solid primary button “Download” or “Get started” → scroll to install or `/docs/install`.
- Theme toggle far right.
- Sticky optional; border-bottom hairline.

---

## 1. Hero

**Headline**

```
The local coding agent harness
```

**Sub**

```
Talk to an LLM that can read, edit, and run tools on your repo —
with permissions, sandboxing, sessions, and observability. BYOK.
```

**Install snippet** (animated tabs)

Tabs: `curl` | `bun` | `npm`

Example content:

```bash
# bun (recommended)
bun add -g zox-code
zox --model openai/gpt-4.1
```

```bash
bunx zox-code --model openai/gpt-4.1
```

Copy button on the active snippet. Tab underline animates.

---

## 2. TUI mock (primary visual)

Full-width or centered dark panel (`#201d1d`) showing a fake session:

```
┌─────────────────────────────────────────────┐
│ zox  ·  anthropic/claude-sonnet-4  ·  worktree │
│─────────────────────────────────────────────│
│ > add a dry-run flag to the CLI             │
│                                             │
│ I'll explore the CLI entrypoint and add     │
│ a --dry-run flag…                           │
│                                             │
│   ○ read packages/cli/src/index.ts          │
│   ○ grep --pattern "flags"                  │
│   ● edit packages/cli/src/parse.ts          │
│                                             │
│ Permission: allow write?  [y] / n           │
└─────────────────────────────────────────────┘
```

**Motion**

- Soft typewriter on the user prompt (once on load or on intersection).
- Tool rows appear sequentially with a brief fade.
- Blinking block cursor on idle prompt line.
- Optional: subtle blue accent bar on the active tool line (like opencode).

In dark mode this block blends with the page; in light mode it is the only large dark surface.

---

## 3. What is Zox?

Short prose + ASCII feature list.

```
Zox is a coding agent harness. The model does not “have” your repo —
the harness holds the session, assembles context, streams the model,
runs tools under policy, and records traces.

It is not a hosted chat product. The agent loop lives on your machine.
```

**Feature rows** (use `[+]` markers):

```
[+] Local-first          Server binds 127.0.0.1; you own the keys
[+] Worktree sandbox     Default isolation via git worktree
[+] Permissions          Approve writes and shell before they run
[+] BYOK providers       Anthropic, OpenAI, Google, Groq, OpenRouter, …
[+] MCP + skills         Extend tools and reusable SKILL.md packs
[+] TUI + SDK            Ink terminal UI and typed @zox/sdk client
```

Link: **Read docs →**

---

## 4. How it works (mental model)

Numbered steps, mono, minimal:

1. You type a request  
2. Optional prompt guardrail (Jev) can allow / ask / deny  
3. Model streams; may emit tool calls  
4. Each tool: permission → hooks → sandbox → execute  
5. Results return to the conversation; loop until done  
6. Usage, traces, transcript stored on the session  

Optional small ASCII diagram (same as README):

```
You (TUI / REPL / SDK)
        │  HTTP + SSE
        ▼
   Zox server  ──► LLM provider
        │
        ├── tools
        ├── sandbox
        ├── hooks
        └── SQLite sessions
```

---

## 5. Privacy / local-first

One short block:

```
Built for privacy first

Zox does not host your code. Keys stay in your environment.
The server runs on your machine. Session data lives in local SQLite.
```

---

## 6. FAQ (accordion, minimal)

| Question | Answer (summary) |
|----------|------------------|
| What is Zox? | Local coding agent harness with tools, permissions, and sandboxing. |
| Do I need a Zox account? | No. BYOK. No auth. |
| How do I install? | `bun add -g zox-code` then `zox --model …` |
| What models work? | Anthropic, OpenAI, Google, Groq, OpenRouter, custom OpenAI-compatible. |
| Does it edit my repo in place? | Default is git worktree under `.zox/worktrees/`. Use `--sandbox host` for in-place. |
| Is it open source? | Yes — MIT (confirm license in repo). |
| How is this different from OpenCode / Claude Code? | Same category; Zox uses its own hooks schema, worktree default, and Bun-first stack. |

Use simple expand/collapse with `+` / `−` or chevron; no heavy animation.

---

## 7. Footer

```
zox
Docs · GitHub · Spec

MIT · Local-first coding harness
```

Hairline top. Caption size. No newsletter for v1 unless requested.

---

## Copy tone

- Direct, technical, short sentences.  
- Prefer “harness” over “assistant” when describing the product.  
- No hype adjectives (“revolutionary”, “blazing”).  
- Match README voice.