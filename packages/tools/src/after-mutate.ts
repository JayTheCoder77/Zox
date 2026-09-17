import type { ToolContext } from "./types.ts";

/** Append afterFileMutate output; never fail the tool if the hook throws. */
export async function appendAfterMutate(
  content: string,
  ctx: Pick<ToolContext, "afterFileMutate">,
  path: string,
): Promise<string> {
  try {
    const extra = await ctx.afterFileMutate?.(path);
    if (extra) return `${content}\n${extra}`;
  } catch {
    // tsc/LSP failures must not fail write/edit
  }
  return content;
}
