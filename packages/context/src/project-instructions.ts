import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const PROJECT_INSTRUCTIONS_MAX_CHARS = 64 * 1024;
export const DEFAULT_INSTRUCTION_FILES = ["AGENTS.md", "ZOXX.md"] as const;

export async function loadProjectInstructions(opts: {
  workspaceRoot: string;
  extraFiles?: string[];
  maxChars?: number;
}): Promise<string> {
  const maxChars = opts.maxChars ?? PROJECT_INSTRUCTIONS_MAX_CHARS;
  const names = [...DEFAULT_INSTRUCTION_FILES, ...(opts.extraFiles ?? [])];
  const chunks: string[] = [];
  let remaining = maxChars;

  for (const name of names) {
    if (remaining <= 0) break;
    const path = resolveInstructionPath(opts.workspaceRoot, name);
    if (!path) continue;
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    if (!text.trim()) continue;
    const slice = text.slice(0, remaining);
    chunks.push(slice);
    remaining -= slice.length;
  }

  return chunks.join("\n\n");
}

function resolveInstructionPath(
  workspaceRoot: string,
  relative: string,
): string | undefined {
  if (!relative.trim() || relative.includes("\0")) return undefined;
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, relative);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) return undefined;
  return candidate;
}
