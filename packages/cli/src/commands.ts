import type { createZoxClient } from "@zox/sdk";
import { SLASH_NAMES } from "./parse.ts";

type SessionHandle = Awaited<
  ReturnType<ReturnType<typeof createZoxClient>["sessions"]["create"]>
>;

export type SlashContext = {
  client: ReturnType<typeof createZoxClient>;
  getSession: () => SessionHandle;
  setSession: (session: SessionHandle) => void;
  workspaceRoot: string;
  sessionDefaults: { agent?: string; model?: string };
};

export async function executeSlash(
  parsed: { name: string; args: string[] },
  ctx: SlashContext,
): Promise<void> {
  const session = ctx.getSession();

  if (parsed.name === "help") {
    console.log(SLASH_NAMES.map((name) => `/${name}`).join("\n"));
    return;
  }

  if (parsed.name === "exit") {
    await session.close();
    process.exit(0);
  }

  if (parsed.name === "clear") {
    await session.close();
    const next = await ctx.client.sessions.create({
      workspaceRoot: ctx.workspaceRoot,
      agent: ctx.sessionDefaults.agent,
      model: ctx.sessionDefaults.model,
    });
    ctx.setSession(next);
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
      console.log(JSON.stringify(result));
      return;
    }
    if (action === "remove" && parsed.args[1]) {
      const result = await ctx.client.mcp.remove(parsed.args[1]);
      console.log(JSON.stringify(result));
      return;
    }
  }

  const result = await session.command(parsed.name, parsed.args);
  console.log(JSON.stringify(result));
}
