# zox-code

CLI for **Zox**, a Bun-first local coding agent harness (TUI, embedded server, tools, sandbox, BYOK).

Requires **[Bun](https://bun.sh)** ≥ 1.2.

## Install

```sh
bun add -g zox-code
# or one-shot
bunx zox-code
```

Binaries: `zox` and `zox-code` (same entry).

```sh
export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY, etc.
zox --model anthropic/claude-sonnet-4-20250514
```

Default sandbox is a git **worktree** under `.zox/worktrees/`. Use `--sandbox host` to edit the current checkout.

Full docs: [github.com/JayTheCoder77/Zox](https://github.com/JayTheCoder77/Zox)
