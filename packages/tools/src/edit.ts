import { jailPath } from "@zox/sandbox";
import description from "./descriptions/edit.txt" with { type: "text" };
import { toolContent, toolDenied, toolError, type ZoxTool } from "./types.ts";

export const editTool: ZoxTool = {
  name: "edit",
  description,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
    },
    required: ["path", "oldString", "newString"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const path = args.path;
    const oldString = args.oldString;
    const newString = args.newString;
    if (
      typeof path !== "string" ||
      typeof oldString !== "string" ||
      oldString.length === 0 ||
      typeof newString !== "string"
    ) {
      return toolError("Invalid arguments for edit");
    }

    const jailed = await jailPath(ctx.sandboxRoot, path);
    if (!jailed.ok) return toolDenied(jailed.reason);

    try {
      const content = await Bun.file(jailed.path).text();
      const matches = content.split(oldString).length - 1;
      if (matches !== 1) {
        return toolError(
          matches === 0
            ? "oldString was not found"
            : `oldString matched ${matches} times`,
        );
      }

      await Bun.write(jailed.path, content.replace(oldString, newString));
      return {
        ok: true,
        ...toolContent(`Edited ${jailed.path}`, ctx.maxToolOutputChars),
      };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Unable to edit file",
      );
    }
  },
};
