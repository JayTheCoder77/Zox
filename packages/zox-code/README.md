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
export OPENROUTER_API_KEY=sk-or-...
zox --model openrouter/openai/gpt-4.1 --sandbox host
```

Or in `.zox/config.json` (the `OPENROUTER_API_KEY` env var is still required):

```json
{
  "model": "openrouter/openai/gpt-4.1",
  "agent": "build",
  "sandbox": { "mode": "host" },
  "providers": {
    "openrouter": {
      "kind": "openai-compatible",
      "baseURL": "https://openrouter.ai/api/v1",
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  }
}
```

Without `"model"`, Zox defaults to `mock/echo`. `providers` does not select a model by itself.

Default sandbox is a git **worktree** under `.zox/worktrees/`. Use `--sandbox host` to edit the current checkout.

Full docs: [github.com/JayTheCoder77/Zox](https://github.com/JayTheCoder77/Zox)
