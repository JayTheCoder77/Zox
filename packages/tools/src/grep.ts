import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { DEFAULT_SANDBOX_CONFIG, jailPath, runSandboxed } from "@zox/sandbox";
import description from "./descriptions/grep.txt" with { type: "text" };
import { toolContent, toolDenied, toolError, type ZoxTool } from "./types.ts";

const MAX_MATCHES = 500;
const MAX_BYTES = 256_000;

export const grepTool: ZoxTool = {
  name: "grep",
  description,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      glob: { type: "string" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (
      typeof args.pattern !== "string" ||
      (args.path !== undefined && typeof args.path !== "string") ||
      (args.glob !== undefined && typeof args.glob !== "string")
    ) {
      return toolError("Invalid arguments for grep", ctx.maxToolOutputChars);
    }

    const jailed = await jailPath(ctx.sandboxRoot, args.path ?? ".");
    if (!jailed.ok) return toolDenied(jailed.reason, ctx.maxToolOutputChars);
    const root = await jailPath(ctx.sandboxRoot, ".");
    if (!root.ok) return toolDenied(root.reason, ctx.maxToolOutputChars);

    try {
      const content = Bun.which("rg")
        ? await grepWithRipgrep(
            args.pattern,
            relative(root.path, jailed.path) || ".",
            args.glob,
            root.path,
          )
        : await grepByWalking(args.pattern, jailed.path, args.glob);
      return { ok: true, ...toolContent(content, ctx.maxToolOutputChars) };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Unable to search files",
        ctx.maxToolOutputChars,
      );
    }
  },
};

async function grepWithRipgrep(
  pattern: string,
  path: string,
  glob: string | undefined,
  root: string,
): Promise<string> {
  const rg = Bun.which("rg");
  if (!rg) throw new Error("ripgrep became unavailable");
  const argv = [
    rg,
    "--line-number",
    "--with-filename",
    "--no-heading",
    "--color=never",
  ];
  if (glob) argv.push("--glob", glob);
  argv.push("--", pattern, path);

  const result = await runSandboxed({
    argv,
    cwd: root,
    config: {
      ...DEFAULT_SANDBOX_CONFIG,
      root,
      maxOutputBytes: MAX_BYTES,
    },
    shell: true,
  });
  if (result.denied) throw new Error(result.denyReason ?? "Search denied");
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(result.stderr || "Search failed");
  }
  return result.stdout.split("\n").slice(0, MAX_MATCHES).join("\n");
}

async function grepByWalking(
  pattern: string,
  path: string,
  fileGlob: string | undefined,
): Promise<string> {
  const matches: string[] = [];
  let bytes = 0;
  const pathStat = await stat(path);
  const candidates = pathStat.isFile()
    ? [path]
    : await Array.fromAsync(
        new Bun.Glob(fileGlob ?? "**/*").scan({
          cwd: path,
          absolute: true,
          onlyFiles: true,
        }),
      );

  for (const filePath of candidates) {
    const data = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    if (data.includes(0)) continue;
    const text = new TextDecoder().decode(data);
    const displayPath =
      relative(path, filePath) || filePath.split("/").at(-1) || filePath;
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.includes(pattern)) continue;
      const match = `${displayPath}:${index + 1}:${line}`;
      const matchBytes = Buffer.byteLength(`${match}\n`);
      if (matches.length >= MAX_MATCHES || bytes + matchBytes > MAX_BYTES) {
        return matches.join("\n");
      }
      matches.push(match);
      bytes += matchBytes;
    }
  }
  return matches.join("\n");
}
