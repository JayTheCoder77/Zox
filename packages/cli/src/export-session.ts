import { createZoxClient } from "@zox/sdk";
import { listen } from "@zox/server";
import type { CliFlags } from "./parse.ts";

export async function runExportSession(opts: {
  sessionId: string;
  flags: CliFlags;
}): Promise<void> {
  let baseUrl = opts.flags.url?.replace(/\/$/, "");
  let token = opts.flags.token ?? process.env.ZOXX_SERVER_TOKEN;
  let server: { port: number; stop(): void } | undefined;

  if (!baseUrl) {
    token = token ?? crypto.randomUUID();
    server = await listen({
      hostname: "127.0.0.1",
      port: opts.flags.port ?? 8787,
      sandboxMode: opts.flags.sandbox,
      token,
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  }

  if (!token) {
    throw new Error("--token or ZOXX_SERVER_TOKEN is required with --url");
  }

  try {
    const client = createZoxClient({ baseUrl, token });
    const session = await client.sessions.get(opts.sessionId);
    const exported = await session.export({
      includeMemory: opts.flags.includeMemory === true,
    });
    console.log(JSON.stringify(exported));
  } finally {
    server?.stop();
  }
}
