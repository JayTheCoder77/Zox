import { resolve } from "node:path";
import { createZoxClient } from "@zox/sdk";
import { listen } from "@zox/server";
import type { CliFlags } from "./parse.ts";
import { runRepl } from "./repl.ts";

export async function runEmbed(flags: CliFlags): Promise<void> {
  const workspaceRoot = resolve(flags.workspace ?? process.cwd());
  let baseUrl = flags.url?.replace(/\/$/, "");
  let token = flags.token ?? process.env.ZOXX_SERVER_TOKEN;
  let server: { port: number; stop(): void } | undefined;

  if (!baseUrl) {
    token = token ?? crypto.randomUUID();
    server = listen({
      hostname: "127.0.0.1",
      port: flags.port ?? 8787,
      sandboxMode: flags.sandbox,
      token,
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  }

  if (!token) {
    throw new Error("--token or ZOXX_SERVER_TOKEN is required with --url");
  }

  try {
    const client = createZoxClient({ baseUrl, token });
    const session = await client.sessions.create({
      workspaceRoot,
      agent: flags.agent,
      model: flags.model,
    });

    const sessionDefaults = { agent: flags.agent, model: flags.model };
    const useTui = process.stdout.isTTY && process.stdin.isTTY && !flags.noTui;

    if (useTui) {
      try {
        const tui = await import("@zox/tui");
        if (typeof tui.runZoxApp === "function") {
          await tui.runZoxApp({
            client,
            session,
            workspaceRoot,
            sessionDefaults,
          });
          return;
        }
      } catch {
        // @zox/tui not installed — fall back to line REPL
      }
    }

    await runRepl({
      client,
      session,
      workspaceRoot,
      sessionDefaults,
    });
  } finally {
    server?.stop();
  }
}
