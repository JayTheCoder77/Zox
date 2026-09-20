# Zox

Bun-first coding agent harness. Spec lives in [`spec/`](./spec/).

## Develop

```sh
bun install
bun test
bun run lint
bun run typecheck
```

## Prompt guardrail (Jev)

Disabled by default. To enable a TypeSafe Jev check on human prompts, set `TYPESAFE_API_KEY` and in `.zox/config.json`:

```json
{
  "judge": {
    "enabled": true
  }
}
```

If the key is missing or Jev errors, the turn continues and the TUI/log shows a skip warning. Prompt `ask` is never auto-approved by `--auto-approve`.
