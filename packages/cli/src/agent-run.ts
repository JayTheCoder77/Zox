import { resolve } from "node:path";
import { createZoxClient } from "@zox/sdk";
import { listen } from "@zox/server";
import type { CliFlags } from "./parse.ts";

const DEFAULT_AGENT_RUN_MAX_TURNS = 50;

export async function runAgentRun(opts: {
  workspace: string;
  task: string;
  flags: CliFlags;
}): Promise<number> {
  const workspaceRoot = resolve(opts.workspace);
  let baseUrl = opts.flags.url?.replace(/\/$/, "");
  let token = opts.flags.token ?? process.env.ZOXX_SERVER_TOKEN;
  let server: { port: number; stop(): void } | undefined;

  const sandboxMode = opts.flags.sandbox ?? "worktree";
  const worktreeCleanup = opts.flags.keepWorktree ? "keep" : "remove";
  const maxTurns = opts.flags.maxTurns ?? DEFAULT_AGENT_RUN_MAX_TURNS;

  if (!baseUrl) {
    token = token ?? crypto.randomUUID();
    server = await listen({
      hostname: "127.0.0.1",
      port: opts.flags.port ?? 8787,
      sandboxMode,
      worktreeCleanup,
      workspaceRoot,
      token,
      budget: { maxTurns },
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
      agent: opts.flags.agent ?? "build",
      model: opts.flags.model,
    });

    const run = session.send(opts.task);

    let lastStatus:
      | "idle"
      | "running"
      | "error"
      | "compacting"
      | "awaiting_permission" = "idle";
    let hadError = false;
    for await (const event of run.events()) {
      if (event.type === "session.status") {
        lastStatus = event.status;
      }
      if (event.type === "error") {
        hadError = true;
      }
      if (event.type === "tool.permission_required") {
        await run.respondPermission(event.requestId, {
          approved: Boolean(opts.flags.autoApprove),
        });
      }
    }

    await session.close();

    return lastStatus === "idle" && !hadError ? 0 : 1;
  } finally {
    server?.stop();
  }
}
