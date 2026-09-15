import { parsePlan } from "@zox/memory";
import description from "./descriptions/todowrite.txt" with { type: "text" };
import { toolContent, toolError, type ZoxTool } from "./types.ts";

export const todowriteTool: ZoxTool = {
  name: "todowrite",
  description,
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "done"],
            },
            notes: { type: "string" },
          },
          required: ["id", "content", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const raw = args.items;
    if (raw === undefined) {
      return toolError("Invalid arguments for todowrite", ctx.maxToolOutputChars);
    }
    try {
      const items = parsePlan(raw);
      return {
        ok: true,
        ...toolContent(JSON.stringify(items), ctx.maxToolOutputChars),
      };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Invalid plan",
        ctx.maxToolOutputChars,
      );
    }
  },
};
