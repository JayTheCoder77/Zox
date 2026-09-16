import { afterEach, describe, expect, test } from "bun:test";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createObservability } from "./index.ts";

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
] as const;

describe("createObservability", () => {
  const previousObservability = process.env.ZOXX_OBSERVABILITY;

  afterEach(() => {
    if (previousObservability === undefined) {
      delete process.env.ZOXX_OBSERVABILITY;
    } else {
      process.env.ZOXX_OBSERVABILITY = previousObservability;
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

  test("enabled startTurn records gen_ai.chat or zox.session span", async () => {
    delete process.env.ZOXX_OBSERVABILITY;
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
});
