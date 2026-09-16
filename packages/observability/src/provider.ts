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

export function installTracerProvider(opts: InstallTracerProviderOpts): {
  owned: boolean;
} {
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
