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
  const executable = command.trim().split(/\s+/, 1)[0] ?? "";
  return inspectArgv([executable], denylist);
}
