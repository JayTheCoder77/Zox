import type { SandboxConfig } from "./types.ts";

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: "worktree",
  root: ".",
  timeoutMs: 120_000,
  maxOutputBytes: 262_144,
  maxToolOutputChars: 32_000,
  denylist: {
    executables: ["sudo", "rm", "mkfs", "dd", "chmod"],
    blockInterpreterOneLiners: true,
    interpreterFlags: ["-c", "-e"],
  },
  worktree: {
    path: ".zox/worktrees",
    branchPrefix: "zox/",
    cleanup: "keep",
    requireGit: true,
  },
};
