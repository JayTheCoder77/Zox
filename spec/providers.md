# Providers and BYOK

## Supported providers (MVP)

| Provider | Auth | Notes |
|----------|------|-------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Messages API, tool use, cache fields |
| **OpenAI** | `OPENAI_API_KEY` | Chat Completions / Responses (pick one in impl) |
| **Google Gemini** | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Unified Google AI SDK |
| **Groq** | `GROQ_API_KEY` | OpenAI-compatible base URL |
| **OpenRouter** | `OPENROUTER_API_KEY` | Single gateway to many models |
| **OpenAI-compatible** | Custom base URL + key | Escape hatch for local LM Studio, etc. |

## Model identifier

Canonical form:

```
<providerId>/<modelId>
```

Examples:

- `anthropic/claude-sonnet-4-20250514`
- `openai/gpt-4.1`
- `google/gemini-2.5-pro`
- `groq/llama-3.3-70b-versatile`
- `openrouter/anthropic/claude-3.5-sonnet`

Catalog:

- Static seed list in repo + optional fetch from OpenRouter/models.dev (cached).
- User overrides in config `models.custom[]`.

## Abstraction interface (`packages/providers`)

```ts
interface ProviderAdapter {
  id: string;
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
  estimateTokens?(params: EstimateParams): number;
  resolveAuth(config: AuthConfig): ResolvedAuth;
}
```

`StreamEvent` variants: `text-delta`, `tool-call-delta`, `tool-call`, `usage`, `error`, `done`.

Implementation recommendation: **Vercel AI SDK** provider modules where available; thin Zox wrapper for usage normalization and tool schema mapping.

## Authentication resolution

1. Session-level override (SDK only, not persisted) for tests.
2. Project `.zox/config.json` → `providers.<id>.apiKeyEnv`.
3. Global `~/.config/zox/config.json`.
4. Process environment.
5. Optional keychain module (V1.5, macOS first).

Never persist raw API keys in SQLite.

## Routing

`ProviderRouter` selects adapter by provider prefix. Responsibilities:

- Translate Zox tool JSON Schema → provider format.
- Normalize usage into `UsageRecord`.
- Retry policy: rate limits (429) with backoff; no retry on 401.
- **Fallback** (optional config): secondary model on specific errors.

## Token usage and cost

Persist per call:

```ts
interface UsageRecord {
  sessionId: string;
  turnId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs: number;
  estimatedUsd?: number; // if catalog has pricing
}
```

Expose:

- CLI footer and `/usage`
- SSE `usage.turn` events
- SDK `session.getUsage()`

## Streaming

- Server forwards provider stream as SSE `message.delta` events.
- Tool calls: accumulate until complete, then `tool.started` before execution.
- Reasoning/thinking models: optional `reasoning.delta` events (hidden in TUI by default).

## Configuration example

```json
{
  "defaultModel": "openrouter/anthropic/claude-sonnet-4",
  "providers": {
    "openrouter": { "apiKeyEnv": "OPENROUTER_API_KEY" },
    "anthropic": { "apiKeyEnv": "ANTHROPIC_API_KEY" },
    "groq": { "apiKeyEnv": "GROQ_API_KEY" }
  }
}
```

## Security

- Redact keys in `GET /config` responses.
- Optional `ZOXX_ALLOW_REMOTE_PROVIDERS=false` to block non-loopback proxy attacks (server-side SSRF guard for `webfetch` separate).
