import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

const TRACER_NAME = "zox";

export type SpanHandle = {
  end(): void;
  traceId: string;
};

function wrapSpan(span: Span): SpanHandle {
  return {
    traceId: span.spanContext().traceId || crypto.randomUUID(),
    end() {
      span.end();
    },
  };
}

export function tracingEnabled(enabled: boolean): boolean {
  return enabled && process.env.ZOXX_OBSERVABILITY !== "0";
}

export function startSessionSpan(): SpanHandle {
  const span = trace.getTracer(TRACER_NAME).startSpan("zox.session");
  return wrapSpan(span);
}

export function startTurnSpan(): SpanHandle {
  const span = trace.getTracer(TRACER_NAME).startSpan("gen_ai.chat", {
    attributes: {
      "gen_ai.operation.name": "chat",
    },
  });
  return wrapSpan(span);
}

export async function withToolSpan<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const span = trace.getTracer(TRACER_NAME).startSpan("zox.tool.execute", {
    attributes: {
      "gen_ai.tool.name": name,
    },
  });
  try {
    return await fn();
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}

export function disabledTraceId(): SpanHandle {
  return {
    traceId: crypto.randomUUID(),
    end() {},
  };
}
