import { mkdir } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { jailPath } from "./jail.ts";
import type { SandboxConfig } from "./types.ts";

export function worktreeRoot(
  workspaceRoot: string,
  sessionId: string,
  path = ".zox/worktrees",
): string {
  assertSafeRelative(path, "worktree.path");
  assertSafeRelative(sessionId, "sessionId");

  const workspace = resolve(workspaceRoot);
  const root = resolve(workspace, path, sessionId);
  if (outside(workspace, root)) {
    throw new Error("worktree path escape: root must stay inside workspace");
  }
  return root;
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
  const parent = await ensureJailedDirectory(
    opts.workspaceRoot,
    relative(resolve(opts.workspaceRoot), dirname(root)),
  );
  const jailedRoot = await jailPath(
    opts.workspaceRoot,
    resolve(parent, basename(root)),
  );
  if (!jailedRoot.ok) {
    throw new Error(`worktree path escape: ${jailedRoot.reason}`);
  }
  const branch = `${opts.config.worktree.branchPrefix}${opts.sessionId}`;
  const process = Bun.spawn(
    [
      "git",
      "-C",
      opts.workspaceRoot,
      "worktree",
      "add",
      "-b",
      branch,
      jailedRoot.path,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git worktree add failed: ${stderr.trim()}`);
  }
  return { root: jailedRoot.path, mode: "worktree" };
}

function assertSafeRelative(value: string, label: string): void {
  if (
    isAbsolute(value) ||
    value.split(/[\\/]/).some((segment) => segment === "..")
  ) {
    throw new Error(`worktree path escape: invalid ${label}`);
  }
}

async function ensureJailedDirectory(
  workspaceRoot: string,
  candidate: string,
): Promise<string> {
  let current = resolve(workspaceRoot);
  for (const segment of candidate.split(sep).filter((part) => part !== ".")) {
    const checked = await jailPath(workspaceRoot, resolve(current, segment));
    if (!checked.ok) {
      throw new Error(`worktree path escape: ${checked.reason}`);
    }
    await mkdir(checked.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const canonical = await jailPath(workspaceRoot, checked.path);
    if (!canonical.ok) {
      throw new Error(`worktree path escape: ${canonical.reason}`);
    }
    current = canonical.path;
  }
  return current;
}

function outside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}
