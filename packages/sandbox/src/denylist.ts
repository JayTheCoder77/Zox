import { basename } from "node:path";
import type { SandboxConfig } from "./types.ts";

export type DenylistConfig = SandboxConfig["denylist"];

const META = /[;|&><`$()]/;

const INTERPRETERS = new Set([
  "python",
  "python3",
  "node",
  "bash",
  "sh",
  "zsh",
  "perl",
  "ruby",
  "php",
]);

export function inspectArgv(
  argv: string[],
  denylist: DenylistConfig,
  opts?: { shell?: boolean },
): { denied: boolean; reason?: string } {
  const exe = basename(argv[0] ?? "");
  if (denylist.executables.includes(exe)) {
    return { denied: true, reason: `denylist executable: ${exe}` };
  }
  if (opts?.shell === false) {
    for (const arg of argv.slice(1)) {
      if (META.test(arg)) {
        return { denied: true, reason: "shell metacharacters refused" };
      }
    }
  }
  if (denylist.blockInterpreterOneLiners && INTERPRETERS.has(exe)) {
    for (const arg of argv.slice(1)) {
      if (denylist.interpreterFlags.includes(arg)) {
        return { denied: true, reason: `interpreter one-liner: ${exe} ${arg}` };
      }
    }
  }
  return { denied: false };
}

export function inspectCommand(
  command: string,
  denylist: DenylistConfig,
): { denied: boolean; reason?: string } {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) return { denied: false };
  return inspectArgv(tokens, denylist);
}

export function tokenizeCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export function looksLikePath(token: string): boolean {
  if (!token || token.startsWith("-")) return false;
  return (
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("~/") ||
    token.includes("..") ||
    token.includes("/")
  );
}
