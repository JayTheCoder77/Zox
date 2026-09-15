import { MemorySessionStore } from "@zox/core";
import {
  createMockAdapter,
  createOpenAIAdapter,
  createProviderRouter,
} from "@zox/providers";
import { createApp } from "./app.ts";

export type { AppRouter } from "./app.ts";
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

  const adapters = [createMockAdapter()];
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    adapters.push(createOpenAIAdapter({ apiKey: openaiKey }));
  }
  const app = createApp({
    token,
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters }),
  });
  const hostname = opts?.hostname ?? "127.0.0.1";
  const port = opts?.port ?? 8787;
  return Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
  });
}
