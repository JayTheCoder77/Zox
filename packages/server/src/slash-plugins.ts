import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BUILTIN_SLASH_NAMES = new Set([
  "help",
  "model",
  "agent",
  "compact",
  "context",
  "usage",
  "clear",
  "mcp",
  "skill",
  "skills",
  "cancel",
  "sandbox",
  "trace",
  "remember",
  "revert",
  "exit",
]);

export type SlashPluginResult =
  | { kind: "prompt"; content: string }
  | { kind: "json"; value: unknown }
  | { kind: "unknown" };

type SlashHandler = (
  args: string[],
) => string | { json: unknown } | Promise<string | { json: unknown }>;

type SlashConfig = {
  slash?: Record<string, SlashHandler>;
};

const configCache = new Map<string, Promise<SlashConfig | undefined>>();

export async function resolveCustomSlash(opts: {
  workspaceRoot: string;
  name: string;
  args: string[];
}): Promise<SlashPluginResult> {
  if (BUILTIN_SLASH_NAMES.has(opts.name)) return { kind: "unknown" };
  if (
    opts.name.includes("..") ||
    opts.name.includes("/") ||
    opts.name.includes("\\")
  ) {
    return { kind: "unknown" };
  }

  const markdownPath = join(
    opts.workspaceRoot,
    ".zox/commands",
    `${opts.name}.md`,
  );
  if (existsSync(markdownPath)) {
    const body = await readFile(markdownPath, "utf8");
    return {
      kind: "prompt",
      content: body.replaceAll("$ARGUMENTS", opts.args.join(" ")),
    };
  }

  const config = await loadSlashConfig(opts.workspaceRoot);
  const handler = config?.slash?.[opts.name];
  if (typeof handler !== "function") return { kind: "unknown" };
  const output = await handler(opts.args);
  if (typeof output === "string") {
    return { kind: "prompt", content: output };
  }
  if (output && typeof output === "object" && "json" in output) {
    return { kind: "json", value: output.json };
  }
  return { kind: "unknown" };
}

function loadSlashConfig(
  workspaceRoot: string,
): Promise<SlashConfig | undefined> {
  const path = join(workspaceRoot, ".zox/zox.config.ts");
  let pending = configCache.get(path);
  if (!pending) {
    pending = importSlashConfig(path);
    configCache.set(path, pending);
  }
  return pending;
}

async function importSlashConfig(
  path: string,
): Promise<SlashConfig | undefined> {
  if (!existsSync(path)) return undefined;
  const mod = (await import(pathToFileURL(path).href)) as {
    default?: SlashConfig;
  };
  const exported = mod.default;
  if (exported && typeof exported === "object") return exported;
  return undefined;
}
