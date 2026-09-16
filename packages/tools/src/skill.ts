import { findSkill } from "@zox/skills";
import description from "./descriptions/skill.txt" with { type: "text" };
import { toolContent, toolError, type ZoxTool } from "./types.ts";

export const skillTool: ZoxTool = {
  name: "skill",
  description,
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const name = args.name;
    if (typeof name !== "string" || name.length === 0) {
      return toolError("Invalid arguments for skill", ctx.maxToolOutputChars);
    }

    const skill = findSkill(name, {
      workspaceRoot: ctx.session.workspaceRoot,
      loadPaths: ctx.loadPaths,
    });
    if (!skill) {
      return toolError(`Skill not found: ${name}`, ctx.maxToolOutputChars);
    }
    ctx.activateSkill?.({
      name: skill.name,
      body: skill.body,
      path: skill.path,
    });
    return {
      ok: true,
      ...toolContent(
        `Loaded skill ${skill.name}. Instructions are now in session context.`,
        ctx.maxToolOutputChars,
      ),
    };
  },
};
