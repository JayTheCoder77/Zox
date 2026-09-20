import { createInterface } from "node:readline/promises";
import type { ZoxEvent } from "@zox/contracts";
import type { createZoxClient } from "@zox/sdk";
import { toolInvocationSummary } from "@zox/tui/format";
import type { SlashContext } from "./commands.ts";
import { executeSlash } from "./commands.ts";
import { parseSlash } from "./parse.ts";
import { promptPermission } from "./permission.ts";

type SessionHandle = Awaited<
  ReturnType<ReturnType<typeof createZoxClient>["sessions"]["create"]>
>;

export async function runRepl(opts: {
  client: ReturnType<typeof createZoxClient>;
  session: SessionHandle;
  workspaceRoot: string;
  sessionDefaults: { agent?: string; model?: string };
}): Promise<void> {
  let session = opts.session;
  const ctx: SlashContext = {
    client: opts.client,
    getSession: () => session,
    setSession: (next) => {
      session = next;
    },
    workspaceRoot: opts.workspaceRoot,
    sessionDefaults: opts.sessionDefaults,
  };

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const line = await rl.question("> ");
      const slash = parseSlash(line);
      if (slash) {
        await executeSlash(slash, ctx);
        continue;
      }
      if (!line.trim()) continue;
      await runTurn(session, line);
    }
  } finally {
    rl.close();
  }
}

async function runTurn(session: SessionHandle, content: string): Promise<void> {
  const run = session.send(content);
  for await (const event of run.events()) {
    await handleEvent(event, run);
  }
  process.stdout.write("\n");
}

async function handleEvent(
  event: ZoxEvent,
  run: ReturnType<SessionHandle["send"]>,
): Promise<void> {
  if (event.type === "message.delta" && event.delta) {
    process.stdout.write(event.delta);
  }
  if (event.type === "tool.started") {
    const summary = toolInvocationSummary(event.name, event.arguments ?? {});
    process.stdout.write(`\n\x1b[33m${summary}\x1b[0m`);
  }
  if (event.type === "tool.completed") {
    process.stdout.write(` — ${event.ok ? "ok" : "denied"}\n`);
  }
  if (event.type === "tool.permission_required") {
    const summary = toolInvocationSummary(event.name, event.arguments ?? {});
    const approved = await promptPermission(summary);
    await run.respondPermission(event.requestId, { approved });
  }
  if (event.type === "prompt.permission_required") {
    const approved = await promptPermission("Submit this prompt anyway?");
    await run.respondPermission(event.requestId, { approved });
  }
  if (event.type === "prompt.guardrail" && event.outcome === "skipped") {
    process.stderr.write(`Judge skipped: ${event.reason ?? "unknown"}\n`);
  }
  if (event.type === "prompt.blocked") {
    process.stderr.write(`Prompt blocked: ${event.reason}\n`);
  }
}
