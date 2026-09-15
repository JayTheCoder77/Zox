import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SandboxConfig } from "./types.ts";

export function worktreeRoot(
  workspaceRoot: string,
  sessionId: string,
  path = ".zox/worktrees",
): string {
  return join(workspaceRoot, path, sessionId);
}

export async function ensureWorktree(opts: {
  workspaceRoot: string;
  sessionId: string;
  config: SandboxConfig;
}): Promise<{
  root: string;
  mode: SandboxConfig["mode"];
  warning?: string;
}> {
  if (opts.config.mode !== "worktree") {
    return { root: opts.workspaceRoot, mode: opts.config.mode };
  }

  const gitCheck = Bun.spawn(
    ["git", "-C", opts.workspaceRoot, "rev-parse", "--is-inside-work-tree"],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await gitCheck.exited) !== 0) {
    if (opts.config.worktree.requireGit) {
      throw new Error(`git repository required: ${opts.workspaceRoot}`);
    }
    return {
      root: opts.workspaceRoot,
      mode: "host",
      warning: "Git repository unavailable; using host workspace",
    };
  }

  const root = worktreeRoot(
    opts.workspaceRoot,
    opts.sessionId,
    opts.config.worktree.path,
  );
  await mkdir(dirname(root), { recursive: true });
  const branch = `${opts.config.worktree.branchPrefix}${opts.sessionId}`;
  const process = Bun.spawn(
    ["git", "-C", opts.workspaceRoot, "worktree", "add", "-b", branch, root],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git worktree add failed: ${stderr.trim()}`);
  }
  return { root, mode: "worktree" };
}
