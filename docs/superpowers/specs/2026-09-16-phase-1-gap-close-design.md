# Phase 1 gap close

Close two remaining Phase 1 spec misses before any Phase 2 work: production OpenTelemetry export, and `todowrite` on the `plan` agent.

## Scope

**In**

- Process-level tracer provider in `@zox/observability`, registered from `createObservability`.
- OTLP HTTP export when an endpoint is configured.
- Honor `ZOXX_OBSERVABILITY=0` (no tracing; Prometheus metrics may still increment).
- Add `todowrite` to the `plan` agent allowlist with permission `allow`.

**Out**

- `/usage` cache tokens and estimated USD.
- `createApp` sandbox `"host"` fallback.
- Remote model catalog, keychain, `agents.custom[]`.
- Prune / protected skill content (Phase 2).
- Full `@opentelemetry/sdk-node`, pino log correlation, GenAI prompt/completion bodies, budget.exceeded.
- Wiring unused `recordContent` to span attributes (privacy default stays off).

## Observability

### Init

`createObservability` owns provider lifecycle. On first enabled init it:

1. Builds a `BasicTracerProvider` with `BatchSpanProcessor`.
2. Sets it as the global tracer provider via `@opentelemetry/api`.
3. Returns the existing metrics + span helper API plus `shutdown()` that flushes and shuts down the provider.

`listen()` passes config/env into `createObservability` and calls `shutdown()` from `server.stop()`.

If a global provider is already installed (unit tests that inject `InMemorySpanExporter`), do not replace it. Production `listen()` is the first installer.

### When tracing is on

Tracing is enabled when `observability.enabled` is not `false` and `ZOXX_OBSERVABILITY` is not `"0"`. Default `enabled` is true (same as today’s `createObservability({ enabled })` from `listen()`, which currently uses `ZOXX_OBSERVABILITY !== "0"`).

### Export

Attach `@opentelemetry/exporter-trace-otlp-http` only when an endpoint is present:

1. `observability.otlp.endpoint` from merged config (project/user JSON).
2. Else `OTEL_EXPORTER_OTLP_ENDPOINT`.

No endpoint: provider still records spans so `/trace` and tests get real trace ids; nothing is sent on the network.

Optional `observability.otlp.headers` is a string map. Values may use `${ENV}` expansion via existing `resolveConfigEnv`. Do not log header values.

Service name: `observability.serviceName` else `OTEL_SERVICE_NAME` else `"zox"`.

### Config schema (`@zox/config`)

Extend `observability`:

```ts
{
  enabled?: boolean;
  serviceName?: string;
  recordContent?: boolean; // already present; unused for bodies
  otlp?: {
    endpoint?: string;
    headers?: Record<string, string>;
  };
  metrics?: boolean | { public?: boolean }; // already present
}
```

### Tests

- Helper or direct `createObservability` with an in-memory exporter (existing pattern): `startTurn` emits `gen_ai.chat` (or `zox.session` if that helper is used).
- `ZOXX_OBSERVABILITY=0` does not record those spans on the in-memory exporter.
- Init with no endpoint does not construct / does not require an OTLP exporter (assert via injected factory or “no fetch”).
- Init with endpoint uses the injected OTLP factory so unit tests never hit the network.

## Plan agent `todowrite`

`PLAN_TOOLS` becomes:

`read`, `grep`, `glob`, `ls`, `skill`, `todowrite`, `memory_search`, `memory_write`.

Ruleset: `todowrite` default `allow` (same as `build`). `write` / `edit` / `bash` remain deny. `webfetch` and `mcp_*` stay off the plan list.

Rationale: `todowrite` mutates session `plan_json`, not the workspace. Plan remains filesystem read-only.

Update `packages/core/src/agents.test.ts` exact array and permission assertions.

## Error handling

- Invalid OTLP URL: fail init with a clear error (do not start the HTTP server with a half-configured exporter).
- OTLP export failures: handled by the exporter/processor; do not fail the agent turn.
- `shutdown()` is best-effort; ignore errors after log to stderr without secrets.

## Success criteria

- With `OTEL_EXPORTER_OTLP_ENDPOINT` set, a mock turn produces a finished `gen_ai.chat` span on a test exporter (or recorded OTLP payload via fake transport).
- With the env unset, a mock turn still completes; no outbound OTLP.
- `getAgentProfile("plan").tools` includes `todowrite`; `evaluatePermission(plan.ruleset, "todowrite")` is `"allow"`.
