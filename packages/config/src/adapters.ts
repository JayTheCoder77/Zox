import {
  createAnthropicAdapter,
  createGoogleAdapter,
  createMockAdapter,
  createOpenAIAdapter,
  createOpenAICompatibleAdapter,
  type ProviderAdapter,
} from "@zox/providers";
import type { ZoxConfig } from "./schema.ts";

export function adaptersFromConfig(
  config: ZoxConfig,
  env: Record<string, string | undefined> = process.env,
): { adapters: ProviderAdapter[]; providerMeta: ZoxConfig["providers"] } {
  const adapters: ProviderAdapter[] = [createMockAdapter()];
  const providers: NonNullable<ZoxConfig["providers"]> = {};

  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    adapters.push(createAnthropicAdapter({ apiKey: anthropicKey }));
    providers.anthropic = { apiKeyEnv: "ANTHROPIC_API_KEY", kind: "anthropic" };
  }

  const openaiKey = env.OPENAI_API_KEY;
  if (openaiKey) {
    adapters.push(createOpenAIAdapter({ apiKey: openaiKey }));
    providers.openai = { apiKeyEnv: "OPENAI_API_KEY", kind: "openai" };
  }

  const googleKey = env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY;
  if (googleKey) {
    adapters.push(createGoogleAdapter({ apiKey: googleKey }));
    providers.google = {
      apiKeyEnv: env.GOOGLE_API_KEY ? "GOOGLE_API_KEY" : "GEMINI_API_KEY",
      kind: "google",
    };
  }

  const groqKey = env.GROQ_API_KEY;
  if (groqKey) {
    adapters.push(
      createOpenAICompatibleAdapter({
        id: "groq",
        apiKey: groqKey,
        baseURL: "https://api.groq.com/openai/v1",
      }),
    );
    providers.groq = { apiKeyEnv: "GROQ_API_KEY", kind: "openai-compatible" };
  }

  const openrouterKey = env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    adapters.push(
      createOpenAICompatibleAdapter({
        id: "openrouter",
        apiKey: openrouterKey,
        baseURL: "https://openrouter.ai/api/v1",
      }),
    );
    providers.openrouter = {
      apiKeyEnv: "OPENROUTER_API_KEY",
      kind: "openai-compatible",
    };
  }

  for (const [id, spec] of Object.entries(config.providers ?? {})) {
    if (adapters.some((adapter) => adapter.id === id)) continue;
    const envName = spec.apiKeyEnv ?? `${id.toUpperCase()}_API_KEY`;
    const apiKey = env[envName];
    if (!apiKey) continue;
    const kind = spec.kind ?? "openai-compatible";
    if (kind === "anthropic") {
      adapters.push(createAnthropicAdapter({ apiKey }));
    } else if (kind === "google") {
      adapters.push(createGoogleAdapter({ apiKey }));
    } else if (kind === "openai") {
      adapters.push(createOpenAIAdapter({ apiKey }));
    } else {
      adapters.push(
        createOpenAICompatibleAdapter({
          id,
          apiKey,
          baseURL: spec.baseURL,
        }),
      );
    }
    providers[id] = { ...spec, apiKeyEnv: envName };
  }

  return { adapters, providerMeta: providers };
}
