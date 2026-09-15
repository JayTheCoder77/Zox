import { listen } from "@zox/server";
import type { CliFlags } from "./parse.ts";

export async function runServe(flags: CliFlags): Promise<{ stop(): void }> {
  const token =
    flags.token ?? process.env.ZOXX_SERVER_TOKEN ?? crypto.randomUUID();
  console.error(token);
  const server = await listen({
    hostname: "127.0.0.1",
    port: flags.port ?? 8787,
    token,
    sandboxMode: flags.sandbox,
  });
  console.error(`http://127.0.0.1:${server.port}`);
  return server;
}
