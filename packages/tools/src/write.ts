import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { jailPath } from "@zox/sandbox";
import { appendAfterMutate } from "./after-mutate.ts";
import description from "./descriptions/write.txt" with { type: "text" };
import { toolContent, toolDenied, toolError, type ZoxTool } from "./types.ts";

export const writeTool: ZoxTool = {
  name: "write",
  description,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const path = args.path;
    const content = args.content;
    if (typeof path !== "string" || typeof content !== "string") {
      return toolError("Invalid arguments for write", ctx.maxToolOutputChars);
    }

    try {
      const parent = await ensureJailedDirectory(
        ctx.sandboxRoot,
        dirname(path),
      );
      if (!parent.ok) {
        return toolDenied(parent.reason, ctx.maxToolOutputChars);
      }

      const jailed = await jailPath(ctx.sandboxRoot, path);
      if (!jailed.ok) return toolDenied(jailed.reason, ctx.maxToolOutputChars);

      await ctx.onFileMutate?.(path);
      await Bun.write(jailed.path, content);
      const resultContent = await appendAfterMutate(
        `Wrote ${jailed.path}`,
        ctx,
        jailed.path,
      );
      return {
        ok: true,
        ...toolContent(resultContent, ctx.maxToolOutputChars),
      };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Unable to write file",
        ctx.maxToolOutputChars,
      );
    }
  },
};

async function ensureJailedDirectory(
  root: string,
  candidate: string,
): Promise<Awaited<ReturnType<typeof jailPath>>> {
  let jailed = await jailPath(root, candidate);
  if (!jailed.ok) {
    const parentCandidate = dirname(candidate);
    if (parentCandidate === candidate) return jailed;

    const parent = await ensureJailedDirectory(root, parentCandidate);
    if (!parent.ok) return parent;

    jailed = await jailPath(root, candidate);
    if (!jailed.ok) return jailed;
  }

  const entry = await stat(jailed.path).catch(() => null);
  if (entry?.isDirectory()) return jailed;
  if (entry) throw new Error(`Not a directory: ${candidate}`);

  const parent = await ensureJailedDirectory(root, dirname(candidate));
  if (!parent.ok) return parent;

  await mkdir(jailed.path);
  return jailPath(root, candidate);
}
