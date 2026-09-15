import {
  DEFAULT_SANDBOX_CONFIG,
  inspectCommand,
  runSandboxed,
} from "@zox/sandbox";
import description from "./descriptions/bash.txt" with { type: "text" };
import {
  type ToolResult,
  toolContent,
  toolDenied,
  toolError,
  type ZoxTool,
} from "./types.ts";

export const bashTool: ZoxTool = {
  name: "bash",
  description,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (typeof args.command !== "string" || args.command.trim() === "") {
      return toolError("Invalid arguments for bash", ctx.maxToolOutputChars);
    }

    const inspection = inspectCommand(
      args.command,
      DEFAULT_SANDBOX_CONFIG.denylist,
    );
    if (inspection.denied) {
      return toolDenied(
        inspection.reason ?? "Command denied",
        ctx.maxToolOutputChars,
      );
    }

    const result = await runSandboxed({
      argv: ["bash", "-lc", args.command],
      cwd: ctx.sandboxRoot,
      config: {
        ...DEFAULT_SANDBOX_CONFIG,
        root: ctx.sandboxRoot,
        maxToolOutputChars: ctx.maxToolOutputChars,
        denylist: {
          ...DEFAULT_SANDBOX_CONFIG.denylist,
          blockInterpreterOneLiners: false,
        },
      },
      shell: true,
    });

    if (result.denied) {
      return toolDenied(
        result.denyReason ?? "Command denied",
        ctx.maxToolOutputChars,
      );
    }

    const content = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const observed = toolContent(content, ctx.maxToolOutputChars);
    return {
      ok: result.ok,
      ...observed,
      truncated: result.truncated || observed.truncated,
    } satisfies ToolResult;
  },
};
