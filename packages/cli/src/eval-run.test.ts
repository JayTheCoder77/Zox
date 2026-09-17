import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evalTaskSchema } from "@zox/contracts";
import { formatEvalAggregate, runEvalSuite, runEvalTask } from "./eval-run.ts";

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

describe("runEvalSuite", () => {
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
