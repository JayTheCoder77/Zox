import { jailPath } from "@zox/sandbox";
import description from "./descriptions/read.txt" with { type: "text" };
import { toolContent, toolDenied, toolError, type ZoxTool } from "./types.ts";

export const readTool: ZoxTool = {
  name: "read",
  description,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const path = args.path;
    const offset = args.offset ?? 1;
    const limit = args.limit;
    if (
      typeof path !== "string" ||
      !isPositiveInteger(offset) ||
      (limit !== undefined && !isPositiveInteger(limit))
    ) {
      return toolError("Invalid arguments for read", ctx.maxToolOutputChars);
    }

    const jailed = await jailPath(ctx.sandboxRoot, path);
    if (!jailed.ok) return toolDenied(jailed.reason, ctx.maxToolOutputChars);

    try {
      const text = await Bun.file(jailed.path).text();
      const lines = text.split("\n");
      const selected = lines.slice(
        offset - 1,
        limit === undefined ? undefined : offset - 1 + limit,
      );
      const numbered = selected
        .map((line, index) => `${offset + index}\t${line}`)
        .join("\n");
      return {
        ok: true,
        ...toolContent(numbered, ctx.maxToolOutputChars),
      };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Unable to read file",
        ctx.maxToolOutputChars,
      );
    }
  },
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
