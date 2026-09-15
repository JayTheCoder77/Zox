import { McpPool } from "@zox/mcp";
import { createObservability } from "@zox/observability";
import {
  createAnthropicAdapter,
  createGoogleAdapter,
  createMockAdapter,
  createOpenAIAdapter,
  createOpenAICompatibleAdapter,
  createProviderRouter,
  type ProviderAdapter,
} from "@zox/providers";
import { DEFAULT_SANDBOX_CONFIG } from "@zox/sandbox";
import { SqliteSessionStore } from "@zox/session";
import { createBuiltinTools, ToolRegistry } from "@zox/tools";
import { type AppConfig, createApp } from "./app.ts";

export type { AppConfig, AppRouter } from "./app.ts";
export { createApp } from "./app.ts";

export function listen(opts?: {
  port?: number;
  hostname?: string;
  token?: string;
}) {
  const fromEnv = process.env.ZOXX_SERVER_TOKEN;
  const token = opts?.token ?? fromEnv ?? crypto.randomUUID();
  if (opts?.token ?? fromEnv) {
    console.error("ZOXX_SERVER_TOKEN set");
  } else {
    console.error("ZOXX_SERVER_TOKEN generated");
  }

  const { adapters, config } = adaptersFromEnv();
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  const metricsEnabled = process.env.ZOXX_OBSERVABILITY !== "0";
  const app = createApp({
    token,
    store: new SqliteSessionStore({ workspaceRoot: process.cwd() }),
    router: createProviderRouter({ adapters }),
    tools,
    mcp: new McpPool(),
    observability: createObservability({ enabled: metricsEnabled }),
    adapterIds: adapters.map((adapter) => adapter.id),
    config: {
      ...config,
      sandbox: { mode: DEFAULT_SANDBOX_CONFIG.mode },
      observability: { metrics: metricsEnabled },
      memory: { autoSummarize: true },
    },
  });
  const hostname = opts?.hostname ?? "127.0.0.1";
  const port = opts?.port ?? 8787;
  return Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
  });
}

function adaptersFromEnv(): { adapters: ProviderAdapter[]; config: AppConfig } {
  const adapters: ProviderAdapter[] = [createMockAdapter()];
  const providers: NonNullable<AppConfig["providers"]> = {};

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    adapters.push(createAnthropicAdapter({ apiKey: anthropicKey }));
    providers.anthropic = { apiKeyEnv: "ANTHROPIC_API_KEY" };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    adapters.push(createOpenAIAdapter({ apiKey: openaiKey }));
    providers.openai = { apiKeyEnv: "OPENAI_API_KEY" };
  }
  const googleKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (googleKey) {
    adapters.push(createGoogleAdapter({ apiKey: googleKey }));
    providers.google = {
      apiKeyEnv: process.env.GOOGLE_API_KEY
        ? "GOOGLE_API_KEY"
        : "GEMINI_API_KEY",
    };
  }
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    adapters.push(
      createOpenAICompatibleAdapter({
        id: "groq",
        apiKey: groqKey,
        baseURL: "https://api.groq.com/openai/v1",
      }),
    );
    providers.groq = { apiKeyEnv: "GROQ_API_KEY" };
  }
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    adapters.push(
      createOpenAICompatibleAdapter({
        id: "openrouter",
        apiKey: openrouterKey,
        baseURL: "https://openrouter.ai/api/v1",
      }),
    );
    providers.openrouter = { apiKeyEnv: "OPENROUTER_API_KEY" };
  }

  return {
    adapters,
    config: {
      model: "mock/echo",
      agent: "build",
      providers,
    },
  };
}
