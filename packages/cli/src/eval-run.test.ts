import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evalTaskSchema } from "@zox/contracts";
import {
  assertLiveEvalReady,
  DEFAULT_EVAL_TASKS_DIR,
  DEFAULT_LIVE_EVAL_MAX_TURNS,
  evalMaxTurns,
  evalSandboxMode,
  failedEvalSummary,
  formatEvalAggregate,
  isLiveEvalDir,
  runEvalSuite,
  runEvalTask,
  withEvalTimeout,
} from "./eval-run.ts";

const resultsDir = resolve("eval/results");
const echoResultPath = join(resultsDir, "echo.json");

afterEach(async () => {
  await rm(resultsDir, { recursive: true, force: true });
});

describe("evalTaskSchema", () => {
  test("defaults model to mock/echo", () => {
    const task = evalTaskSchema.parse({
      id: "echo",
      prompt: "ping",
      expect: { stdoutIncludes: "ping" },
    });
    expect(task.model).toBe("mock/echo");
  });

  test("parses live yaml fixtures from eval/tasks/live", async () => {
    const dir = resolve("eval/tasks/live");
    const names = [
      "bash-ls.yaml",
      "edit-add.yaml",
      "grep-glob.yaml",
      "write-module.yaml",
    ];
    for (const name of names) {
      const raw = await readFile(join(dir, name), "utf8");
      const task = evalTaskSchema.parse(Bun.YAML.parse(raw));
      expect(task.expect.files?.length).toBeGreaterThan(0);
    }
  });
});

describe("runEvalTask", () => {
  test("echo fixture passes with mock/echo", async () => {
    const summary = await runEvalTask({
      id: "echo",
      prompt: "ping",
      model: "mock/echo",
      expect: { stdoutIncludes: "ping" },
    });
    expect(summary.pass).toBe(true);
    expect(summary.turns).toBeGreaterThan(0);
  });

  test("writes gitignored eval/results/<taskId>.json", async () => {
    await runEvalTask({
      id: "echo",
      prompt: "ping",
      model: "mock/echo",
      expect: { stdoutIncludes: "ping" },
    });
    const written = JSON.parse(await readFile(echoResultPath, "utf8")) as {
      taskId: string;
      pass: boolean;
    };
    expect(written.taskId).toBe("echo");
    expect(written.pass).toBe(true);
    const gitignore = await readFile(resolve(".gitignore"), "utf8");
    expect(gitignore).toContain("eval/results/");
  });

  test("fails when expected file content is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "zox-eval-files-"));
    await writeFile(
      join(workspace, "add.ts"),
      "export const add = (a, b) => a - b;\n",
    );
    const summary = await runEvalTask({
      id: "missing-fix",
      prompt: "ping",
      workspace,
      model: "mock/echo",
      expect: { files: [{ path: "add.ts", contains: "return a + b" }] },
    });
    expect(summary.pass).toBe(false);
  });
});

describe("formatEvalAggregate", () => {
  test("prints pass@1, turns/task, and $/task", () => {
    expect(
      formatEvalAggregate([
        { taskId: "echo", pass: true, turns: 1, usd: null },
      ]),
    ).toBe("pass@1 1/1\nturns/task echo=1\n$/task echo=n/a");
  });
});

describe("eval task dirs", () => {
  test("defaults the suite to eval/tasks/mock", () => {
    expect(DEFAULT_EVAL_TASKS_DIR).toBe("eval/tasks/mock");
  });

  test("isLiveEvalDir is true only for eval/tasks/live", () => {
    expect(isLiveEvalDir("eval/tasks/live")).toBe(true);
    expect(isLiveEvalDir(resolve("eval/tasks/live"))).toBe(true);
    expect(isLiveEvalDir("eval/tasks/mock")).toBe(false);
    expect(isLiveEvalDir("/tmp/eval/tasks/live")).toBe(true);
  });
});

describe("assertLiveEvalReady", () => {
  test("does nothing for mock dirs", () => {
    expect(() => assertLiveEvalReady("eval/tasks/mock")).not.toThrow();
  });

  test("requires --model for live dirs", () => {
    expect(() => assertLiveEvalReady("eval/tasks/live")).toThrow(/--model/);
  });

  test("rejects mock models for live dirs", () => {
    expect(() =>
      assertLiveEvalReady("eval/tasks/live", { model: "mock/echo" }),
    ).toThrow(/mock/);
  });

  test("allows a real model for live dirs", () => {
    expect(() =>
      assertLiveEvalReady("eval/tasks/live", {
        model: "anthropic/claude-sonnet-4-20250514",
      }),
    ).not.toThrow();
  });
});

describe("eval runner policy", () => {
  test("live defaults to worktree sandbox and 50 max turns", () => {
    expect(evalSandboxMode(true, {})).toBe("worktree");
    expect(evalMaxTurns(true, {})).toBe(DEFAULT_LIVE_EVAL_MAX_TURNS);
    expect(DEFAULT_LIVE_EVAL_MAX_TURNS).toBe(50);
  });

  test("mock defaults to host sandbox and unbounded turns", () => {
    expect(evalSandboxMode(false, {})).toBe("host");
    expect(evalMaxTurns(false, {})).toBeUndefined();
  });

  test("flags override sandbox and maxTurns", () => {
    expect(evalSandboxMode(true, { sandbox: "host" })).toBe("host");
    expect(evalMaxTurns(false, { maxTurns: 3 })).toBe(3);
  });

  test("failedEvalSummary is a failed pass@1 row", () => {
    expect(failedEvalSummary("edit-add")).toEqual({
      taskId: "edit-add",
      pass: false,
      turns: 0,
      usd: null,
    });
  });

  test("withEvalTimeout returns fallback when work hangs", async () => {
    const fallback = failedEvalSummary("slow");
    const result = await withEvalTimeout(
      new Promise<typeof fallback>(() => {}),
      20,
      fallback,
    );
    expect(result).toEqual(fallback);
  });
});

describe("runEvalSuite", () => {
  test("throws when the tasks dir has no yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zox-eval-empty-"));
    await expect(runEvalSuite({ tasksDir: dir })).rejects.toThrow(
      /no eval tasks/i,
    );
  });

  test("live suite fails fast without --model", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-eval-live-"));
    const tasksDir = join(root, "eval/tasks/live");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(
      join(tasksDir, "edit-add.yaml"),
      "id: edit-add\nprompt: ping\nexpect:\n  stdoutIncludes: ping\n",
    );
    await expect(runEvalSuite({ tasksDir })).rejects.toThrow(/--model/);
  });

  test("live suite rejects mock/echo even when --model is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-eval-live-mock-"));
    const tasksDir = join(root, "eval/tasks/live");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(
      join(tasksDir, "edit-add.yaml"),
      "id: edit-add\nprompt: ping\nexpect:\n  stdoutIncludes: ping\n",
    );
    await expect(
      runEvalSuite({ tasksDir, flags: { model: "mock/echo" } }),
    ).rejects.toThrow(/mock/);
  });

  test("default suite directory is mock-only", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const summaries = await runEvalSuite({});
      expect(summaries.every((row) => row.taskId !== "edit-add")).toBe(true);
      expect(summaries.some((row) => row.taskId === "echo")).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  test("loads yaml sequentially and prints aggregate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zox-eval-suite-"));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "echo.yaml"),
      "id: echo\nprompt: ping\nexpect:\n  stdoutIncludes: ping\n",
    );
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const summaries = await runEvalSuite({ tasksDir: dir });
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.pass).toBe(true);
    } finally {
      console.log = originalLog;
    }
    expect(logs.join("\n")).toContain("pass@1 1/1");
    expect(logs.join("\n")).toContain("turns/task echo=1");
    expect(logs.join("\n")).toContain("$/task echo=n/a");
  });
});
