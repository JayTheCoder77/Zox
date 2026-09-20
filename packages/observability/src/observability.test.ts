import { afterEach, describe, expect, test } from "bun:test";
import { ProxyTracerProvider, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createObservability } from "./index.ts";

function isNoopDelegate(): boolean {
  const provider = trace.getTracerProvider();
  if (!(provider instanceof ProxyTracerProvider)) return false;
  return provider.getDelegate().constructor.name === "NoopTracerProvider";
}

async function forceFlushGlobalProvider(): Promise<void> {
  const raw = trace.getTracerProvider();
  const provider = raw instanceof ProxyTracerProvider ? raw.getDelegate() : raw;
  if (provider instanceof BasicTracerProvider) {
    await provider.forceFlush();
  }
}

const METRIC_NAMES = [
  "zox_turns_total",
  "zox_tool_calls_total",
  "zox_tokens_total",
  "zox_turn_duration_seconds",
  "zox_model_latency_seconds",
  "zox_context_estimated_tokens",
  "zox_compactions_total",
  "zox_session_cost_usd",
  "zox_hook_duration_seconds",
  "zox_skills_loads_total",
  "zox_judge_calls_total",
  "zox_judge_latency_seconds",
] as const;

describe("createObservability", () => {
  const previousObservability = process.env.ZOXX_OBSERVABILITY;
  const previousOtlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const previousServiceName = process.env.OTEL_SERVICE_NAME;

  afterEach(() => {
    trace.disable();
    if (previousObservability === undefined) {
      delete process.env.ZOXX_OBSERVABILITY;
    } else {
      process.env.ZOXX_OBSERVABILITY = previousObservability;
    }
    if (previousOtlpEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previousOtlpEndpoint;
    }
    if (previousServiceName === undefined) {
      delete process.env.OTEL_SERVICE_NAME;
    } else {
      process.env.OTEL_SERVICE_NAME = previousServiceName;
    }
  });

  test("synthetic turn renders zox_turns_total and token counters", () => {
    const obs = createObservability({ enabled: false });
    const turn = obs.startTurn();
    obs.recordTokens("openai", 12, 4);
    obs.recordTool("read", false);
    turn.end();
    const text = obs.renderPrometheus();
    expect(text).toMatch(/zox_turns_total\s+1\b/);
    expect(text).toContain(
      'zox_tokens_total{provider="openai",direction="input"} 12',
    );
    expect(text).toContain(
      'zox_tokens_total{provider="openai",direction="output"} 4',
    );
    expect(text).toContain(
      'zox_tool_calls_total{tool_name="read",denied="false"} 1',
    );
    for (const name of METRIC_NAMES) {
      expect(text).toContain(name);
    }
  });

  test("disabled tracing still increments prometheus and returns a uuid traceId", () => {
    process.env.ZOXX_OBSERVABILITY = "0";
    const obs = createObservability({ enabled: true });
    const turn = obs.startTurn();
    expect(turn.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    obs.recordTokens("anthropic", 1, 2);
    turn.end();
    expect(obs.renderPrometheus()).toMatch(/zox_turns_total\s+1\b/);
  });

  test("records remaining prometheus series without prompt bodies", () => {
    const obs = createObservability({ enabled: false, recordContent: false });
    obs.startTurn().end();
    obs.recordModelLatency(0.05);
    obs.recordContextEstimated(128);
    obs.recordCompaction("manual");
    obs.recordSessionCost(0.12);
    obs.recordHookDuration("PreToolUse", 0.002);
    obs.recordTool("bash", true);
    const text = obs.renderPrometheus();
    expect(text).toContain("zox_model_latency_seconds");
    expect(text).toMatch(/zox_context_estimated_tokens\s+128\b/);
    expect(text).toContain('zox_compactions_total{kind="manual"} 1');
    expect(text).toContain('zox_compactions_total{kind="auto"} 0');
    expect(text).toMatch(/zox_session_cost_usd\s+0\.12\b/);
    expect(text).toContain('zox_hook_duration_seconds{event="PreToolUse"}');
    expect(text).toContain(
      'zox_tool_calls_total{tool_name="bash",denied="true"} 1',
    );
    expect(text.toLowerCase()).not.toContain("system prompt");
    expect(text).not.toMatch(/user content|prompt body/i);
  });

  test("recordJudge counts outcomes and omits prompt text by default", () => {
    const obs = createObservability({ enabled: false, recordContent: false });
    obs.recordJudge({
      latencyMs: 12,
      outcome: "skipped",
      reason: "http_500",
      prompt: "SECRET PROMPT BODY",
    });
    const text = obs.renderPrometheus();
    expect(text).toContain(
      'zox_judge_calls_total{outcome="skipped",question=""} 1',
    );
    expect(text).toContain("zox_judge_latency_seconds");
    expect(text).not.toContain("SECRET PROMPT BODY");
  });

  test("enabled startTurn records gen_ai.chat or zox.session span", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    trace.disable();
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    const obs = createObservability({ enabled: true });
    const turn = obs.startTurn();
    expect(turn.traceId.length).toBeGreaterThan(0);
    turn.end();
    await provider.forceFlush();
    const names = exporter.getFinishedSpans().map((span) => span.name);
    expect(
      names.some((name) => name === "gen_ai.chat" || name === "zox.session"),
    ).toBe(true);
  });

  test("startTurn records zox.skills.active on the span", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    trace.disable();
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    const obs = createObservability({ enabled: true });
    const turn = obs.startTurn({ "zox.skills.active": "helper" });
    turn.end();
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(
      spans.some((span) => span.attributes["zox.skills.active"] === "helper"),
    ).toBe(true);
  });

  test("startTurn with spanExporter records gen_ai.chat after installing provider", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    trace.disable();
    const exporter = new InMemorySpanExporter();
    const obs = createObservability({ enabled: true, spanExporter: exporter });
    const turn = obs.startTurn();
    turn.end();
    await forceFlushGlobalProvider();
    const names = exporter.getFinishedSpans().map((span) => span.name);
    expect(names).toContain("gen_ai.chat");
    await obs.shutdown();
    expect(isNoopDelegate()).toBe(true);
  });

  test("ZOXX_OBSERVABILITY=0 does not record spans on the in-memory exporter", async () => {
    process.env.ZOXX_OBSERVABILITY = "0";
    trace.disable();
    const exporter = new InMemorySpanExporter();
    const obs = createObservability({ enabled: true, spanExporter: exporter });
    const turn = obs.startTurn();
    turn.end();
    await forceFlushGlobalProvider();
    expect(exporter.getFinishedSpans()).toEqual([]);
    await obs.shutdown();
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
    await forceFlushGlobalProvider();
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:4318/v1/traces",
        headers: { Authorization: "Bearer secret-token" },
      },
    ]);
    expect(otlpExporter.getFinishedSpans().map((s) => s.name)).toContain(
      "gen_ai.chat",
    );
    await obs.shutdown();
  });

  test("OTEL_EXPORTER_OTLP_ENDPOINT is used when config endpoint is absent", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://otel.example:4318/v1/traces";
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
});
