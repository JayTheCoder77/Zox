import { searchDurableMemories } from "@zox/memory";
import description from "./descriptions/memory_search.txt" with {
  type: "text",
};
import { toolContent, toolError, type ZoxTool } from "./types.ts";

export const memorySearchTool: ZoxTool = {
  name: "memory_search",
  description,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const query = args.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      return toolError(
        "Invalid arguments for memory_search",
        ctx.maxToolOutputChars,
      );
    }
    if (!ctx.memoryDb) {
      return toolError("Durable memory is unavailable", ctx.maxToolOutputChars);
    }
    const hits = searchDurableMemories(
      ctx.memoryDb,
      query,
      ctx.session.workspaceRoot,
    );
    const body = hits
      .map((hit) => `pinned: ${hit.pinned}\n${hit.content}`)
      .join("\n\n");
    return {
      ok: true,
      ...toolContent(
        body.length > 0 ? body : "No matches",
        ctx.maxToolOutputChars,
      ),
    };
  },
};
