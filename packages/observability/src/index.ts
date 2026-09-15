import { createMetrics, type ZoxMetrics } from "./metrics.ts";
import { disabledTraceId, startTurnSpan, tracingEnabled } from "./traces.ts";

export type { ZoxMetrics };

export type Observability = {
  startTurn(): { end(): void; traceId: string };
  recordTool(name: string, denied: boolean): void;
  recordTokens(provider: string, input: number, output: number): void;
  recordModelLatency(seconds: number): void;
  recordContextEstimated(tokens: number): void;
  recordCompaction(kind: "manual" | "auto"): void;
  recordSessionCost(usd: number): void;
  recordHookDuration(event: string, seconds: number): void;
  renderPrometheus(): string;
};

export function createObservability(opts: {
  enabled: boolean;
  recordContent?: boolean;
}): Observability {
  const recordContent = opts.recordContent ?? false;
  void recordContent;
  const metrics = createMetrics();

  return {
    startTurn() {
      metrics.recordTurn();
      const started = performance.now();
      const span = tracingEnabled(opts.enabled)
        ? startTurnSpan()
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
    renderPrometheus() {
      return metrics.renderPrometheus();
    },
  };
}

export { createMetrics } from "./metrics.ts";
export {
  startSessionSpan,
  startTurnSpan,
  withToolSpan,
} from "./traces.ts";
