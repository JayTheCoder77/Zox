import { readdir } from "node:fs/promises";
import { jailPath } from "@zox/sandbox";
import description from "./descriptions/ls.txt" with { type: "text" };
import { toolContent, toolDenied, toolError, type ZoxTool } from "./types.ts";

export const lsTool: ZoxTool = {
  name: "ls",
  description,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (args.path !== undefined && typeof args.path !== "string") {
      return toolError("Invalid arguments for ls", ctx.maxToolOutputChars);
    }

    const jailed = await jailPath(ctx.sandboxRoot, args.path ?? ".");
    if (!jailed.ok) return toolDenied(jailed.reason, ctx.maxToolOutputChars);

    try {
      const entries = await readdir(jailed.path, { withFileTypes: true });
      const content = entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .sort()
        .join("\n");
      return { ok: true, ...toolContent(content, ctx.maxToolOutputChars) };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Unable to list directory",
        ctx.maxToolOutputChars,
      );
    }
  },
};
