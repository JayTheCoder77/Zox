import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PRIVATE_K,
  discoverPrivateTasks,
  loadPrivateMeta,
  runPrivateSuite,
} from "./eval-private.ts";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeSuite(): Promise<{ root: string; taskDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "zox-private-"));
  scratch.push(root);
  const taskDir = join(root, "001-fix-add");
  await mkdir(join(taskDir, "repo"), { recursive: true });
  await mkdir(join(taskDir, "tests"), { recursive: true });
  await writeFile(
    join(taskDir, "README.md"),
    "Fix add.ts so add(2, 2) is 4.\n",
  );
  await writeFile(
    join(taskDir, "meta.json"),
    JSON.stringify({
      budgetMinutes: 5,
      tags: ["bugfix"],
      difficulty: "easy",
    }),
  );
  await writeFile(
    join(taskDir, "repo", "add.ts"),
    "export const add = (a, b) => a - b;\n",
  );
  await writeFile(join(taskDir, "tests", "secret.txt"), "hidden-from-agent\n");
  const grader = join(taskDir, "grader.sh");
  await writeFile(
    grader,
    `#!/usr/bin/env bash
set -euo pipefail
cd "$1"
grep -q "a + b" add.ts
`,
  );
  await chmod(grader, 0o755);
  return { root, taskDir };
}

describe("discoverPrivateTasks", () => {
  test("finds versioned task dirs with README and grader", async () => {
    const { root, taskDir } = await makeSuite();
    const tasks = await discoverPrivateTasks(root);
    expect(tasks).toEqual([taskDir]);
  });
});

describe("loadPrivateMeta", () => {
  test("parses budget, tags, and difficulty", async () => {
    const { taskDir } = await makeSuite();
    expect(await loadPrivateMeta(taskDir)).toEqual({
      budgetMinutes: 5,
      tags: ["bugfix"],
      difficulty: "easy",
    });
  });
});

describe("runPrivateSuite", () => {
  test("default k is 3", () => {
    expect(DEFAULT_PRIVATE_K).toBe(3);
  });

  test("ships 8 versioned tasks under eval/private", async () => {
    const { resolve } = await import("node:path");
    const { discoverPrivateTasks } = await import("./eval-private.ts");
    const tasks = await discoverPrivateTasks(resolve("eval/private"));
    expect(tasks.map((dir) => dir.split("/").at(-1))).toEqual([
      "001-fix-add",
      "002-add-dry-run",
      "003-extract-helper",
      "004-wire-endpoint",
      "005-broken-import",
      "006-csv-transform",
      "007-recovery",
      "008-list-src",
    ]);
  });

  test("copies repo only, grades, and archives artifacts for k trials", async () => {
    const { root } = await makeSuite();
    const resultsDir = await mkdtemp(join(tmpdir(), "zox-private-results-"));
    scratch.push(resultsDir);
    let seenWorkspaces = 0;
    const summaries = await runPrivateSuite({
      tasksDir: root,
      flags: { model: "anthropic/claude-sonnet-4-20250514", k: 2 },
      resultsDir,
      runAgent: async ({ workspace, task }) => {
        seenWorkspaces += 1;
        expect(task).toContain("add(2, 2)");
        const listing = await Bun.spawn(["ls", "-A"], {
          cwd: workspace,
          stdout: "pipe",
        });
        const names = (await new Response(listing.stdout).text()).split("\n");
        expect(names).not.toContain("tests");
        expect(names).not.toContain("secret.txt");
        await writeFile(
          join(workspace, "add.ts"),
          "export const add = (a, b) => a + b;\n",
        );
        return {
          pass: true,
          turns: 2,
          usd: 0.01,
          latencyMs: 12,
          toolCalls: 3,
          toolFailures: 0,
          transcript: "fixed add\n",
        };
      },
    });
    expect(seenWorkspaces).toBe(2);
    expect(summaries).toHaveLength(2);
    expect(summaries.every((row) => row.pass)).toBe(true);
    const trialDir = join(resultsDir, "001-fix-add", "trial-1");
    expect(await readFile(join(trialDir, "transcript.txt"), "utf8")).toContain(
      "fixed add",
    );
    expect(await readFile(join(trialDir, "patch.diff"), "utf8")).toContain(
      "a + b",
    );
    const summary = JSON.parse(
      await readFile(join(trialDir, "summary.json"), "utf8"),
    );
    expect(summary.taskId).toBe("001-fix-add");
    expect(summary.trial).toBe(1);
    expect(summary.pass).toBe(true);
  });

  test("fails the trial when grader.sh exits non-zero", async () => {
    const { root } = await makeSuite();
    const resultsDir = await mkdtemp(join(tmpdir(), "zox-private-fail-"));
    scratch.push(resultsDir);
    const summaries = await runPrivateSuite({
      tasksDir: root,
      flags: { model: "anthropic/x", k: 1 },
      resultsDir,
      runAgent: async () => ({
        pass: true,
        turns: 1,
        usd: null,
        latencyMs: 1,
        toolCalls: 0,
        toolFailures: 0,
        transcript: "noop\n",
      }),
    });
    expect(summaries[0]?.pass).toBe(false);
  });
});
