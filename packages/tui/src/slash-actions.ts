import type { createZoxClient } from "@zox/sdk";
import { SLASH_NAMES } from "./slash.ts";

type SessionHandle = Awaited<
  ReturnType<ReturnType<typeof createZoxClient>["sessions"]["create"]>
>;

export type SlashContext = {
  client: ReturnType<typeof createZoxClient>;
  getSession: () => SessionHandle;
  setSession: (session: SessionHandle) => void;
  workspaceRoot: string;
  sessionDefaults: { agent?: string; model?: string };
  onOutput: (line: string) => void;
  onExit: () => void;
};

export async function executeSlash(
  parsed: { name: string; args: string[] },
  ctx: SlashContext,
): Promise<void> {
  const session = ctx.getSession();

  if (parsed.name === "help") {
    ctx.onOutput(SLASH_NAMES.map((name) => `/${name}`).join("\n"));
    return;
  }

  if (parsed.name === "exit") {
    await session.close();
    ctx.onExit();
    return;
  }

  if (parsed.name === "clear") {
    await session.close();
    const next = await ctx.client.sessions.create({
      workspaceRoot: ctx.workspaceRoot,
      agent: ctx.sessionDefaults.agent,
      model: ctx.sessionDefaults.model,
    });
    ctx.setSession(next);
    ctx.onOutput("Session cleared.");
    return;
  }

  if (parsed.name === "mcp") {
    const action = parsed.args[0];
    if (action === "add" && parsed.args[1] && parsed.args[2]) {
      const result = await ctx.client.mcp.add({
        name: parsed.args[1],
        command: parsed.args[2],
        args: parsed.args.slice(3),
      });
      ctx.onOutput(JSON.stringify(result));
      return;
    }
    if (action === "remove" && parsed.args[1]) {
      const result = await ctx.client.mcp.remove(parsed.args[1]);
      ctx.onOutput(JSON.stringify(result));
      return;
    }
  }

  const result = await session.command(parsed.name, parsed.args);
  ctx.onOutput(JSON.stringify(result));
}
