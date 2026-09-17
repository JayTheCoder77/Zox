import description from "./descriptions/task.txt" with { type: "text" };
import { toolContent, toolError, type ZoxTool } from "./types.ts";

export const taskTool: ZoxTool = {
  name: "task",
  description,
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      agent: { type: "string", enum: ["build", "plan"] },
      description: { type: "string" },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!ctx.runSubagent || !ctx.parentSession) {
      return toolError(
        "Subagent runtime not available",
        ctx.maxToolOutputChars,
      );
    }
    const prompt = args.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      return toolError("Invalid arguments for task", ctx.maxToolOutputChars);
    }
    const agent =
      args.agent === "build" || args.agent === "plan" ? args.agent : "plan";
    const result = await ctx.runSubagent({
      parent: ctx.parentSession,
      prompt,
      agent,
    });
    return {
      ok: result.ok,
      ...toolContent(result.text, ctx.maxToolOutputChars),
    };
  },
};
