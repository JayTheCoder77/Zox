import { createMetrics, type ZoxMetrics } from "./metrics.ts";
import {
  assertOtlpEndpoint,
  installTracerProvider,
  resolveOtlpEndpoint,
  resolveServiceName,
  shutdownOwnedTracerProvider,
  type CreateObservabilityOpts,
  type OtlpExporterFactory,
} from "./provider.ts";
import {
  disabledTraceId,
  startTurnSpan,
  tracingEnabled,
  withToolSpan,
} from "./traces.ts";

export type { ZoxMetrics };
export type { CreateObservabilityOpts, OtlpExporterFactory };

export type Observability = {
  startTurn(attrs?: { "zox.skills.active"?: string }): {
    end(): void;
    traceId: string;
  };
  recordTool(name: string, denied: boolean): void;
  recordTokens(provider: string, input: number, output: number): void;
  recordModelLatency(seconds: number): void;
  recordContextEstimated(tokens: number): void;
  recordCompaction(kind: "manual" | "auto"): void;
  recordSessionCost(usd: number): void;
  recordHookDuration(event: string, seconds: number): void;
  recordSkillLoad(source: "slash" | "tool" | "auto"): void;
  withTool<T>(name: string, fn: () => Promise<T>): Promise<T>;
  renderPrometheus(): string;
  shutdown(): Promise<void>;
};

export function createObservability(
  opts: CreateObservabilityOpts = {},
): Observability {
  const enabled = opts.enabled ?? true;
  const recordContent = opts.recordContent ?? false;
  void recordContent;
  const metrics = createMetrics();

  let installed = { owned: false as boolean };
  if (tracingEnabled(enabled)) {
    const endpoint = resolveOtlpEndpoint(opts.otlp?.endpoint);
    if (endpoint !== undefined) {
      assertOtlpEndpoint(endpoint);
    }
    installed = installTracerProvider({
      serviceName: resolveServiceName(opts.serviceName),
      otlpEndpoint: endpoint,
      otlpHeaders: opts.otlp?.headers,
      spanExporter: opts.spanExporter,
      createOtlpExporter: opts.createOtlpExporter,
    });
  }

  return {
    startTurn(attrs) {
      metrics.recordTurn();
      const started = performance.now();
      const span = tracingEnabled(enabled)
        ? startTurnSpan(attrs)
        : disabledTraceId();
      return {
        traceId: span.traceId,
        end() {
          metrics.observeTurnDuration((performance.now() - started) / 1000);
          span.end();
        },
      };
    },
    recordTool(name: string, denied: boolean) {
      metrics.recordTool(name, denied);
    },
    recordTokens(provider: string, input: number, output: number) {
      metrics.recordTokens(provider, input, output);
    },
    recordModelLatency(seconds: number) {
      metrics.observeModelLatency(seconds);
    },
    recordContextEstimated(tokens: number) {
      metrics.setContextEstimated(tokens);
    },
    recordCompaction(kind: "manual" | "auto") {
      metrics.recordCompaction(kind);
    },
    recordSessionCost(usd: number) {
      metrics.setSessionCost(usd);
    },
    recordHookDuration(event: string, seconds: number) {
      metrics.observeHookDuration(event, seconds);
    },
    recordSkillLoad(source: "slash" | "tool" | "auto") {
      metrics.recordSkillLoad(source);
    },
    async withTool<T>(name: string, fn: () => Promise<T>): Promise<T> {
      if (!tracingEnabled(enabled)) {
        return fn();
      }
      return withToolSpan(name, fn);
    },
    renderPrometheus() {
      return metrics.renderPrometheus();
    },
    async shutdown() {
      if (!installed.owned) return;
      await shutdownOwnedTracerProvider();
    },
  };
}

export { createMetrics } from "./metrics.ts";
export {
  startSessionSpan,
  startTurnSpan,
  withToolSpan,
} from "./traces.ts";
