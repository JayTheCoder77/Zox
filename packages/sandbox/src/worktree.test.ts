import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { DEFAULT_SANDBOX_CONFIG } from "./defaults.ts";
import { ensureWorktree, worktreeRoot } from "./worktree.ts";

test("builds the configured worktree root", () => {
  expect(worktreeRoot("/workspace", "sess_abc")).toBe(
    join("/workspace", ".zox/worktrees", "sess_abc"),
  );
  expect(worktreeRoot("/workspace", "sess_abc", "tmp/trees")).toBe(
    join("/workspace", "tmp/trees", "sess_abc"),
  );
});

test("creates git worktree under .zox/worktrees/<sessionId>", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-wt-"));
  await $`git init`.cwd(workspaceRoot);
  await $`git add -A`.cwd(workspaceRoot).nothrow();
  await Bun.write(join(workspaceRoot, "README"), "x");
  await $`git -c user.email=a@b.c -c user.name=zox add README && git -c user.email=a@b.c -c user.name=zox commit -m init`.cwd(
    workspaceRoot,
  );
  const sessionId = "sess_abc";
  const result = await ensureWorktree({
    workspaceRoot,
    sessionId,
    config: { ...DEFAULT_SANDBOX_CONFIG, mode: "worktree" },
  });
  expect(result.mode).toBe("worktree");
  expect(result.root).toBe(join(workspaceRoot, ".zox/worktrees", sessionId));
  expect(await Bun.file(join(result.root, "README")).text()).toBe("x");
});

test("falls back to host with warning when not git and requireGit is false", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-nongit-"));
  const result = await ensureWorktree({
    workspaceRoot,
    sessionId: "s1",
    config: {
      ...DEFAULT_SANDBOX_CONFIG,
      mode: "worktree",
      worktree: {
        ...DEFAULT_SANDBOX_CONFIG.worktree,
        requireGit: false,
      },
    },
  });
  expect(result.mode).toBe("host");
  expect(result.root).toBe(workspaceRoot);
  expect(result.warning).toMatch(/git/i);
});
