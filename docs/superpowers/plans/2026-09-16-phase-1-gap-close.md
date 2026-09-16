# Phase 1 Gap Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits:** Do not `git commit` unless Jayant explicitly asks. Commit steps below are checkpoints only.
>
> **Spec:** [2026-09-16-phase-1-gap-close-design.md](../specs/2026-09-16-phase-1-gap-close-design.md)

**Goal:** Close the two remaining Phase 1 spec misses: process-level OpenTelemetry with optional OTLP HTTP export, and `todowrite` on the `plan` agent.

**Architecture:** `@zox/observability.createObservability` becomes the process owner of a `BasicTracerProvider` (install once if the global provider is still a noop). Attach `OTLPTraceExporter` only when an endpoint is configured. `listen()` passes merged config + env and calls `shutdown()` from `stop()`. The `plan` profile adds `todowrite` with `allow`; workspace mutation tools stay deny.

**Tech Stack:** Bun workspaces, `bun:test`, `@opentelemetry/api@1.9.0`, `@opentelemetry/sdk-trace-base@2.2.0`, `@opentelemetry/exporter-trace-otlp-http@0.208.0`, `@opentelemetry/resources@2.2.0` (already transitive; add as a direct dep), Zod config schema.

## Global Constraints

- Runtime: Bun only (`bun install`, `bun run`, `bun test`). No pnpm/npm CLI in scripts.
- Style: `createX` factories, `bun:test`, `.ts` import extensions, Zod in `@zox/config`, no `any`.
- Do not break existing Phase 0/1/1.5 tests. Extend them.
- `ZOXX_OBSERVABILITY=0` disables tracing only. Prometheus counters must still increment.
- Do not replace an already-installed global tracer provider (unit tests that call `trace.setGlobalTracerProvider`).
- Do not log OTLP header values or prompt/completion bodies. `recordContent` stays unused for span bodies.
- Do not start `Bun.serve` if OTLP init throws (invalid URL).
- OTLP export failures must not fail the agent turn (exporter/processor handles them).
- **Out of scope:** `/usage` cache tokens and estimated USD; `createApp` sandbox `"host"` fallback; remote catalog/keychain/`agents.custom[]`; prune; `@opentelemetry/sdk-node`; pino correlation; `budget.exceeded`; GenAI prompt bodies.

---

## File structure

| Path | Responsibility |
|------|----------------|
| `packages/core/src/agents.ts` | Add `todowrite` to `PLAN_TOOLS` (ruleset inherits `allow`) |
| `packages/core/src/agents.test.ts` | Exact plan tool array + `todowrite` allow |
| `packages/config/src/schema.ts` | `observability.enabled`, `serviceName`, `otlp.endpoint`, `otlp.headers` |
| `packages/config/src/load.test.ts` | Parse the new observability fields |
| `packages/observability/package.json` | Direct deps: OTLP HTTP exporter + resources |
| `packages/observability/src/provider.ts` | Detect noop global provider; install `BasicTracerProvider`; OTLP + shutdown |
| `packages/observability/src/index.ts` | `createObservability` opts, `shutdown()`, call provider install |
| `packages/observability/src/observability.test.ts` | In-memory spans, env off, no OTLP factory, invalid URL |
| `packages/server/src/index.ts` | Pass config/env into `createObservability`; `stop()` → `shutdown()` |
| `packages/server/src/index.test.ts` | Invalid OTLP endpoint rejects `listen()` |

---

### Task 1: Plan agent `todowrite`

**Files:**
- Modify: `packages/core/src/agents.ts`
- Modify: `packages/core/src/agents.test.ts`

**Interfaces:**
- Consumes: `getAgentProfile`, `evaluatePermission`, `toolMatchesProfile` (existing)
- Produces: `getAgentProfile("plan").tools` includes `"todowrite"` between `"skill"` and `"memory_search"`; `evaluatePermission(plan.ruleset, "todowrite")` is `"allow"`

- [ ] **Step 1: Write the failing assertions**

In `packages/core/src/agents.test.ts`, update the plan tools array and add the permission assertion:

```ts
    expect(plan.tools).toEqual([
      "read",
      "grep",
      "glob",
      "ls",
      "skill",
      "todowrite",
      "memory_search",
      "memory_write",
    ]);
    expect(evaluatePermission(plan.ruleset, "todowrite")).toBe("allow");
    expect(evaluatePermission(plan.ruleset, "memory_search")).toBe("allow");
```

Keep the existing deny assertions for `write` / `read` / `mcp_*` / `webfetch`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/agents.test.ts`

Expected: FAIL — `plan.tools` does not equal the new array (missing `"todowrite"`).

- [ ] **Step 3: Add `todowrite` to `PLAN_TOOLS`**

In `packages/core/src/agents.ts`, change `PLAN_TOOLS` to:

```ts
const PLAN_TOOLS = [
  "read",
  "grep",
  "glob",
  "ls",
  "skill",
  "todowrite",
  "memory_search",
  "memory_write",
];
```

Do not add `todowrite` to the deny list. `ruleset(PLAN_TOOLS, ["write", "edit", "bash"])` already sets listed tools to `{ default: "allow" }`. Leave `memory_write` as `ask`. Do not add `webfetch` or `mcp_*` to the plan list.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/agents.test.ts`

Expected: PASS (3 tests).

- [ ] **Step 5: Commit (checkpoint only unless Jayant asked)**

```bash
git add packages/core/src/agents.ts packages/core/src/agents.test.ts
git commit -m "$(cat <<'EOF'
fix(core): allow todowrite on the plan agent

Plan stays filesystem read-only; todowrite only mutates session plan_json.
EOF
)"
```

---

### Task 2: Observability config schema

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/load.test.ts`

**Interfaces:**
- Consumes: existing `zoxConfigSchema.observability` (`recordContent`, `metrics`)
- Produces:

```ts
observability?: {
  enabled?: boolean;
  serviceName?: string;
  recordContent?: boolean;
  otlp?: {
    endpoint?: string;
    headers?: Record<string, string>;
  };
  metrics?: boolean | { public?: boolean };
};
```

- [ ] **Step 1: Write the failing schema test**

Add to `packages/config/src/load.test.ts` inside `describe("zoxConfigSchema"`):

```ts
  test("parses observability otlp endpoint, headers, enabled, and serviceName", () => {
    const parsed = zoxConfigSchema.parse({
      observability: {
        enabled: true,
        serviceName: "zox-dev",
        recordContent: false,
        otlp: {
          endpoint: "http://localhost:4318/v1/traces",
          headers: { Authorization: "Bearer ${LANGFUSE_OTEL_TOKEN}" },
        },
        metrics: { public: false },
      },
    });
    expect(parsed.observability?.enabled).toBe(true);
    expect(parsed.observability?.serviceName).toBe("zox-dev");
    expect(parsed.observability?.otlp?.endpoint).toBe(
      "http://localhost:4318/v1/traces",
    );
    expect(parsed.observability?.otlp?.headers).toEqual({
      Authorization: "Bearer ${LANGFUSE_OTEL_TOKEN}",
    });
  });
```

Schema parse must **not** expand `${ENV}` here. Expansion happens later in `listen()` via `resolveConfigEnv`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/config/src/load.test.ts`

Expected: FAIL with Zod unrecognized keys or missing fields (`enabled` / `serviceName` / `otlp`).

- [ ] **Step 3: Extend the Zod object**

In `packages/config/src/schema.ts`, replace the `observability` object with:

```ts
  observability: z
    .object({
      enabled: z.boolean().optional(),
      serviceName: z.string().min(1).optional(),
      recordContent: z.boolean().optional(),
      otlp: z
        .object({
          endpoint: z.string().optional(),
          headers: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
      metrics: z
        .union([
          z.boolean(),
          z.object({
            public: z.boolean().optional(),
          }),
        ])
        .optional(),
    })
    .optional(),
```

Keep `zoxConfigSchema` otherwise unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/config/src/load.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit (checkpoint only unless Jayant asked)**

```bash
git add packages/config/src/schema.ts packages/config/src/load.test.ts
git commit -m "$(cat <<'EOF'
feat(config): add observability otlp and serviceName fields

Allow project/user JSON to set OTLP HTTP export without env-only wiring.
EOF
)"
```

---

### Task 3: Process tracer provider + OTLP factory

**Files:**
- Create: `packages/observability/src/provider.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: `packages/observability/src/observability.test.ts`
- Modify: `packages/observability/package.json`

**Interfaces:**
- Consumes: `tracingEnabled` from `traces.ts`; `@opentelemetry/api` `trace`, `ProxyTracerProvider`; `BasicTracerProvider`, `BatchSpanProcessor`, `SimpleSpanProcessor`, `SpanExporter` from `@opentelemetry/sdk-trace-base`
- Produces:

```ts
export type OtlpExporterFactory = (opts: {
  url: string;
  headers?: Record<string, string>;
}) => SpanExporter;

export type CreateObservabilityOpts = {
  enabled?: boolean;
  recordContent?: boolean;
  serviceName?: string;
  otlp?: {
    endpoint?: string;
    headers?: Record<string, string>;
  };
  spanExporter?: SpanExporter;
  createOtlpExporter?: OtlpExporterFactory;
};

export type Observability = {
  // existing methods unchanged
  shutdown(): Promise<void>;
};

export function createObservability(opts?: CreateObservabilityOpts): Observability;
```

Resolution rules (implement exactly):

- Tracing on when `(opts.enabled ?? true)` and `process.env.ZOXX_OBSERVABILITY !== "0"`.
- Endpoint: `opts.otlp?.endpoint?.trim()` else `process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()`. Empty → no OTLP.
- Service name: `opts.serviceName` else `process.env.OTEL_SERVICE_NAME` else `"zox"`.
- Invalid endpoint: `new URL(endpoint)` throws → throw `new Error(\`Invalid OTLP endpoint: ${endpoint}\`)` (do not include headers).
- If a real global tracer provider is already installed, do not replace it and do not attach processors. `shutdown()` on that instance is a no-op.
- If this instance installed the provider, `shutdown()` calls `provider.shutdown()`, then `trace.disable()`, and clears the module owner so a later init can install again.
- `shutdown()` is best-effort: catch errors, `console.error` a message plus `error.message` only (never header maps).

- [ ] **Step 1: Add dependencies**

In `packages/observability/package.json` `dependencies`:

```json
{
  "@opentelemetry/api": "1.9.0",
  "@opentelemetry/exporter-trace-otlp-http": "0.208.0",
  "@opentelemetry/resources": "2.2.0",
  "@opentelemetry/sdk-trace-base": "2.2.0",
  "@opentelemetry/semantic-conventions": "1.43.0"
}
```

Run: `bun install`

Expected: lockfile updates; install succeeds.

- [ ] **Step 2: Write the failing provider tests**

Append these tests to `packages/observability/src/observability.test.ts`. Import `SpanExporter` only if needed. Restore env in `afterEach` (already present). Also restore `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` if a test sets them.

Add at the top of the new describe (or extend the existing one):

```ts
import { ProxyTracerProvider, trace } from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

function isNoopDelegate(): boolean {
  const provider = trace.getTracerProvider();
  if (!(provider instanceof ProxyTracerProvider)) return false;
  return provider.getDelegate().constructor.name === "NoopTracerProvider";
}
```

Tests (exact behavior):

```ts
  test("startTurn with spanExporter records gen_ai.chat after installing provider", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    trace.disable();
    const exporter = new InMemorySpanExporter();
    const obs = createObservability({ enabled: true, spanExporter: exporter });
    const turn = obs.startTurn();
    turn.end();
    await obs.shutdown();
    const names = exporter.getFinishedSpans().map((span) => span.name);
    expect(names).toContain("gen_ai.chat");
    expect(isNoopDelegate()).toBe(true);
  });

  test("ZOXX_OBSERVABILITY=0 does not record spans on the in-memory exporter", async () => {
    process.env.ZOXX_OBSERVABILITY = "0";
    trace.disable();
    const exporter = new InMemorySpanExporter();
    const obs = createObservability({ enabled: true, spanExporter: exporter });
    const turn = obs.startTurn();
    turn.end();
    await obs.shutdown();
    expect(exporter.getFinishedSpans()).toEqual([]);
    expect(obs.renderPrometheus()).toMatch(/zox_turns_total\s+1\b/);
  });

  test("no endpoint does not call createOtlpExporter", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    trace.disable();
    let called = 0;
    const obs = createObservability({
      enabled: true,
      createOtlpExporter: () => {
        called += 1;
        throw new Error("OTLP factory should not run");
      },
    });
    obs.startTurn().end();
    await obs.shutdown();
    expect(called).toBe(0);
  });

  test("endpoint uses injected OTLP factory and records a finished gen_ai.chat span", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    trace.disable();
    const otlpExporter = new InMemorySpanExporter();
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const obs = createObservability({
      enabled: true,
      serviceName: "zox-test",
      otlp: {
        endpoint: "http://127.0.0.1:4318/v1/traces",
        headers: { Authorization: "Bearer secret-token" },
      },
      createOtlpExporter: (opts) => {
        calls.push(opts);
        return otlpExporter;
      },
    });
    obs.startTurn().end();
    await obs.shutdown();
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:4318/v1/traces",
        headers: { Authorization: "Bearer secret-token" },
      },
    ]);
    expect(otlpExporter.getFinishedSpans().map((s) => s.name)).toContain(
      "gen_ai.chat",
    );
  });

  test("OTEL_EXPORTER_OTLP_ENDPOINT is used when config endpoint is absent", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel.example:4318/v1/traces";
    trace.disable();
    const urls: string[] = [];
    const exporter = new InMemorySpanExporter();
    const obs = createObservability({
      enabled: true,
      createOtlpExporter: ({ url }) => {
        urls.push(url);
        return exporter;
      },
    });
    await obs.shutdown();
    expect(urls).toEqual(["http://otel.example:4318/v1/traces"]);
  });

  test("invalid OTLP endpoint fails init", () => {
    delete process.env.ZOXX_OBSERVABILITY;
    trace.disable();
    expect(() =>
      createObservability({
        enabled: true,
        otlp: { endpoint: "not-a-url" },
      }),
    ).toThrow("Invalid OTLP endpoint: not-a-url");
  });

  test("does not replace an already installed global provider", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    trace.disable();
    const existing = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(existing)],
    });
    trace.setGlobalTracerProvider(provider);
    let factoryCalls = 0;
    const obs = createObservability({
      enabled: true,
      otlp: { endpoint: "http://127.0.0.1:4318/v1/traces" },
      createOtlpExporter: () => {
        factoryCalls += 1;
        return new InMemorySpanExporter();
      },
    });
    obs.startTurn().end();
    await provider.forceFlush();
    await obs.shutdown();
    expect(factoryCalls).toBe(0);
    expect(existing.getFinishedSpans().map((s) => s.name)).toContain(
      "gen_ai.chat",
    );
  });
```

Existing tests that `setGlobalTracerProvider` **before** `createObservability` must keep passing (they already follow that order). Do not remove them.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test packages/observability/src/observability.test.ts`

Expected: FAIL — `createObservability` does not accept `spanExporter` / `createOtlpExporter` / `otlp`, has no `shutdown`, and does not throw on invalid URL.

- [ ] **Step 4: Implement `provider.ts`**

Create `packages/observability/src/provider.ts`:

```ts
import { ProxyTracerProvider, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export type OtlpExporterFactory = (opts: {
  url: string;
  headers?: Record<string, string>;
}) => SpanExporter;

export type InstallTracerProviderOpts = {
  serviceName: string;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  spanExporter?: SpanExporter;
  createOtlpExporter?: OtlpExporterFactory;
};

let installedProvider: BasicTracerProvider | undefined;

export function hasRealGlobalTracerProvider(): boolean {
  const provider = trace.getTracerProvider();
  if (!(provider instanceof ProxyTracerProvider)) {
    return true;
  }
  return provider.getDelegate().constructor.name !== "NoopTracerProvider";
}

export function defaultOtlpExporterFactory(opts: {
  url: string;
  headers?: Record<string, string>;
}): SpanExporter {
  return new OTLPTraceExporter({
    url: opts.url,
    headers: opts.headers,
  });
}

export function resolveOtlpEndpoint(
  configEndpoint: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = configEndpoint?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return raw ? raw : undefined;
}

export function resolveServiceName(
  configName: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  return configName?.trim() || env.OTEL_SERVICE_NAME?.trim() || "zox";
}

export function assertOtlpEndpoint(endpoint: string): void {
  try {
    new URL(endpoint);
  } catch {
    throw new Error(`Invalid OTLP endpoint: ${endpoint}`);
  }
}

export function installTracerProvider(
  opts: InstallTracerProviderOpts,
): { owned: boolean } {
  if (hasRealGlobalTracerProvider()) {
    return { owned: false };
  }

  const processors: Array<SimpleSpanProcessor | BatchSpanProcessor> = [];
  if (opts.spanExporter) {
    processors.push(new SimpleSpanProcessor(opts.spanExporter));
  }
  if (opts.otlpEndpoint) {
    assertOtlpEndpoint(opts.otlpEndpoint);
    const factory = opts.createOtlpExporter ?? defaultOtlpExporterFactory;
    const exporter = factory({
      url: opts.otlpEndpoint,
      headers: opts.otlpHeaders,
    });
    processors.push(new BatchSpanProcessor(exporter));
  }

  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: opts.serviceName,
    }),
    spanProcessors: processors,
  });
  trace.setGlobalTracerProvider(provider);
  installedProvider = provider;
  return { owned: true };
}

export async function shutdownOwnedTracerProvider(): Promise<void> {
  const provider = installedProvider;
  if (!provider) return;
  installedProvider = undefined;
  try {
    await provider.shutdown();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("zox observability shutdown failed:", message);
  } finally {
    trace.disable();
  }
}
```

Validate the OTLP URL **before** `hasRealGlobalTracerProvider` skip? Spec: fail init with a clear error so the HTTP server does not start with a half-configured exporter. Invalid URL must throw even if a test provider is already installed **only if we would have used OTLP**. Production `listen()` is the first installer, so throwing in `installTracerProvider` after the noop check is enough **except** we still want `listen()` to fail on bad config before serve. `createObservability` should `assertOtlpEndpoint` when an endpoint is present **before** the skip, so misconfig never silently no-ops:

In `createObservability`, if tracing is on and endpoint is set, call `assertOtlpEndpoint(endpoint)` first, then `installTracerProvider`.

- [ ] **Step 5: Wire `createObservability`**

Update `packages/observability/src/index.ts`:

- Import `installTracerProvider`, `resolveOtlpEndpoint`, `resolveServiceName`, `assertOtlpEndpoint`, `shutdownOwnedTracerProvider`, and the new option types from `./provider.ts`. Re-export the types.
- Change `createObservability` signature to `opts: CreateObservabilityOpts = {}`.
- `const enabled = opts.enabled ?? true`.
- Keep `tracingEnabled(enabled)` for span helpers.
- When `tracingEnabled(enabled)`:
  1. `const endpoint = resolveOtlpEndpoint(opts.otlp?.endpoint);`
  2. If `endpoint` is defined, `assertOtlpEndpoint(endpoint)`.
  3. `const installed = installTracerProvider({ serviceName: resolveServiceName(opts.serviceName), otlpEndpoint: endpoint, otlpHeaders: opts.otlp?.headers, spanExporter: opts.spanExporter, createOtlpExporter: opts.createOtlpExporter });`
- Return existing metrics/span API plus:

```ts
    async shutdown() {
      if (!installed.owned) return;
      await shutdownOwnedTracerProvider();
    },
```

When tracing is **off**, `installed = { owned: false }` and `shutdown` is a no-op (do not disable a test-injected provider).

`recordContent` stays unused (`void recordContent`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/observability/src/observability.test.ts`

Expected: PASS, including the older `setGlobalTracerProvider` tests.

If `ATTR_SERVICE_NAME` is not exported from `@opentelemetry/semantic-conventions@1.43.0`, use the string `"service.name"` (OTel attribute) instead — do not invent another package.

If `resourceFromAttributes` is not exported from resources 2.2.0, use:

```ts
import { resourceFromAttributes } from "@opentelemetry/resources";
```

Resources 2.2.0 in this repo already exists as a transitive dependency of `sdk-trace-base`.

- [ ] **Step 7: Commit (checkpoint only unless Jayant asked)**

```bash
git add packages/observability/package.json bun.lock packages/observability/src/provider.ts packages/observability/src/index.ts packages/observability/src/observability.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): install process tracer provider and optional OTLP

Export gen_ai.chat spans when an endpoint is set; skip replace when tests inject a provider.
EOF
)"
```

---

### Task 4: `listen()` init and shutdown

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/index.test.ts`

**Interfaces:**
- Consumes: `loadZoxConfig` → `observability`; `resolveConfigEnv`; `createObservability` from Task 3 (`shutdown()`, `otlp`, `serviceName`, `enabled`)
- Produces: `listen()` constructs observability from config/env **before** `Bun.serve`; `stop()` calls `server.stop()` then `void observability.shutdown()`

Header expansion (do not log values):

```ts
function resolveOtlpHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = resolveConfigEnv(value);
  }
  return out;
}
```

- [ ] **Step 1: Write the failing listen test**

Add to `packages/server/src/index.test.ts`:

```ts
  test("rejects listen when observability.otlp.endpoint is not a URL", async () => {
    const project = await mkdtemp(join(tmpdir(), "zox-listen-otlp-"));
    await mkdir(join(project, ".zox"), { recursive: true });
    await writeFile(
      join(project, ".zox", "config.json"),
      JSON.stringify({
        observability: { otlp: { endpoint: "not-a-url" } },
      }),
    );

    prevCwd = process.cwd();
    process.chdir(project);
    await expect(
      listen({
        port: 0,
        token: "otlp-bad-token",
        sandboxMode: "host",
      }),
    ).rejects.toThrow("Invalid OTLP endpoint: not-a-url");
  });
```

Do **not** push a server into `servers` on this test (nothing should bind).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/index.test.ts`

Expected: FAIL — `listen()` currently ignores `observability.otlp` and starts the HTTP server.

- [ ] **Step 3: Wire `listen()`**

In `packages/server/src/index.ts`:

1. Import `resolveConfigEnv` from `@zox/config` (add to the existing import).
2. Add `resolveOtlpHeaders` as a private function in this file (same pattern as `resolveMcpServerEnv`).
3. Replace the `createObservability` call. Stop using `metricsEnabled` as the tracing flag.

```ts
  const observability = createObservability({
    enabled: zoxConfig.observability?.enabled,
    recordContent: zoxConfig.observability?.recordContent ?? false,
    serviceName: zoxConfig.observability?.serviceName,
    otlp: {
      endpoint: zoxConfig.observability?.otlp?.endpoint,
      headers: resolveOtlpHeaders(zoxConfig.observability?.otlp?.headers),
    },
  });
```

Keep `const metricsEnabled = process.env.ZOXX_OBSERVABILITY !== "0"` only if it is still used for `config.observability` fallback `{ metrics: metricsEnabled }`. Do not pass that value as `createObservability({ enabled })`.

4. Change the returned `stop()`:

```ts
    stop() {
      server.stop();
      void observability.shutdown();
    },
```

Place `createObservability` **before** `Bun.serve` (it already is). A throw must skip `Bun.serve`.

- [ ] **Step 4: Run listen tests**

Run: `bun test packages/server/src/index.test.ts`

Expected: PASS including the new rejection test and existing hook/config tests.

- [ ] **Step 5: Regression slice**

Run:

```bash
bun test packages/observability/src/observability.test.ts packages/config/src/load.test.ts packages/core/src/agents.test.ts packages/server/src/index.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit (checkpoint only unless Jayant asked)**

```bash
git add packages/server/src/index.ts packages/server/src/index.test.ts
git commit -m "$(cat <<'EOF'
feat(server): init OTel from config and flush on stop

Fail listen on an invalid OTLP URL so the process never serves half-configured traces.
EOF
)"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|------------------|------|
| Process-level tracer from `createObservability` | 3 |
| OTLP HTTP only when endpoint set (config then `OTEL_EXPORTER_OTLP_ENDPOINT`) | 3 |
| `ZOXX_OBSERVABILITY=0` skips spans; Prometheus still increments | 3 |
| Do not replace injected global provider | 3 |
| `listen()` passes config/env; `stop()` → `shutdown()` | 4 |
| `observability.otlp.headers` + `${ENV}` via `resolveConfigEnv` | 2 (schema) + 4 (expand) |
| Service name: config → `OTEL_SERVICE_NAME` → `"zox"` | 3 |
| Config schema fields | 2 |
| Invalid OTLP URL fails init / does not serve | 3 + 4 |
| `shutdown()` best-effort, no secrets in logs | 3 |
| `PLAN_TOOLS` + `todowrite` allow | 1 |
| Tests: in-memory `gen_ai.chat`, env off, no factory, injected factory | 3 |

**Out of spec (do not implement):** sdk-node, pino, prompt bodies, `recordContent` span attrs, `/usage` USD, host sandbox fallback, custom agents, prune.

**Placeholder scan:** none — tests and implementation are fully specified.

**Type consistency:** `CreateObservabilityOpts`, `OtlpExporterFactory`, `shutdown(): Promise<void>`, `resolveOtlpEndpoint` / `resolveServiceName` / `assertOtlpEndpoint` names match across Tasks 3–4.
