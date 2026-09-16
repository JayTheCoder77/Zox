import { writeDurableMemory } from "@zox/memory";
import description from "./descriptions/memory_write.txt" with { type: "text" };
import { toolContent, toolError, type ZoxTool } from "./types.ts";

export const memoryWriteTool: ZoxTool = {
  name: "memory_write",
  description,
  parameters: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
    required: ["content"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const content = args.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return toolError(
        "Invalid arguments for memory_write",
        ctx.maxToolOutputChars,
      );
    }
    if (!ctx.memoryDb) {
      return toolError("Durable memory is unavailable", ctx.maxToolOutputChars);
    }
    const row = await writeDurableMemory(ctx.memoryDb, {
      workspaceRoot: ctx.session.workspaceRoot,
      content,
      pinned: false,
    });
    return {
      ok: true,
      ...toolContent(`Wrote unpinned memory ${row.id}`, ctx.maxToolOutputChars),
    };
  },
};
