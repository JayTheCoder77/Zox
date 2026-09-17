import { codeChunkCount, indexWorkspace, searchCode } from "@zox/memory";
import description from "./descriptions/code_search.txt" with { type: "text" };
import { toolContent, toolError, type ZoxTool } from "./types.ts";

export const codeSearchTool: ZoxTool = {
  name: "code_search",
  description,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const query = args.query;
    const limit = args.limit;
    if (
      typeof query !== "string" ||
      query.trim().length === 0 ||
      (limit !== undefined && (typeof limit !== "number" || limit < 1))
    ) {
      return toolError(
        "Invalid arguments for code_search",
        ctx.maxToolOutputChars,
      );
    }
    if (!ctx.memoryDb) {
      return toolError("Code index is unavailable", ctx.maxToolOutputChars);
    }
    if (codeChunkCount(ctx.memoryDb) === 0) {
      await indexWorkspace({
        db: ctx.memoryDb,
        workspaceRoot: ctx.session.workspaceRoot,
        sandboxRoot: ctx.sandboxRoot,
      });
    }
    const hits = searchCode({
      db: ctx.memoryDb,
      query,
      limit: typeof limit === "number" ? limit : undefined,
    });
    const body = hits
      .map(
        (hit) =>
          `${hit.path}:${hit.startLine}\n${hit.text}`,
      )
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
