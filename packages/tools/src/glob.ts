import { isAbsolute, relative } from "node:path";
import { jailPath } from "@zox/sandbox";
import description from "./descriptions/glob.txt" with { type: "text" };
import { toolContent, toolDenied, toolError, type ZoxTool } from "./types.ts";

export const globTool: ZoxTool = {
  name: "glob",
  description,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (
      typeof args.pattern !== "string" ||
      args.pattern === "" ||
      isAbsolute(args.pattern) ||
      args.pattern.split("/").includes("..")
    ) {
      return toolError("Invalid arguments for glob", ctx.maxToolOutputChars);
    }

    const root = await jailPath(ctx.sandboxRoot, ".");
    if (!root.ok) return toolDenied(root.reason, ctx.maxToolOutputChars);

    try {
      const matches: string[] = [];
      for await (const match of new Bun.Glob(args.pattern).scan({
        cwd: root.path,
        absolute: true,
        dot: true,
      })) {
        const jailed = await jailPath(root.path, match);
        if (jailed.ok) matches.push(relative(root.path, jailed.path));
      }
      matches.sort();
      return {
        ok: true,
        ...toolContent(matches.join("\n"), ctx.maxToolOutputChars),
      };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Unable to match files",
        ctx.maxToolOutputChars,
      );
    }
  },
};
