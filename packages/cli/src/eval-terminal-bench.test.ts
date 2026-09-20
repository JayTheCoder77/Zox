import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { linuxBunDownloadUrls, linuxBunSlug } from "./eval-bench.ts";
import {
  assertOfficialBenchModel,
  assertTerminalBenchReady,
  buildHarborRun,
  loadSmokeIds,
  runTerminalBench,
  selectSmokeIds,
  TERMINAL_BENCH_SMOKE_PATH,
} from "./eval-terminal-bench.ts";

describe("assertOfficialBenchModel", () => {
  test("requires --model", () => {
    expect(() => assertOfficialBenchModel("terminal-bench", undefined)).toThrow(
      "terminal-bench requires --model <provider/id>",
    );
  });

  test("rejects mock models", () => {
    expect(() =>
      assertOfficialBenchModel("terminal-bench", "mock/echo"),
    ).toThrow("terminal-bench reject mock models; pass a real --model");
  });
});

describe("smoke tasks", () => {
  test("loads default names from eval/benchmarks/terminal-bench-smoke.json", async () => {
    const names = await loadSmokeIds(TERMINAL_BENCH_SMOKE_PATH, "task_names");
    expect(names).toEqual([
      "openssl-selfsigned-cert",
      "fix-git",
      "nginx-request-logging",
    ]);
  });

  test("uses --task over smoke list", () => {
    expect(
      selectSmokeIds(["a", "b", "c"], { tasks: ["fix-git"], limit: 3 }),
    ).toEqual(["fix-git"]);
  });
});

describe("harbor argv", () => {
  test("builds harbor run with ZOX_ROOT and installed agent import", () => {
    const built = buildHarborRun({
      model: "anthropic/claude-sonnet-4-20250514",
      taskNames: ["openssl-selfsigned-cert"],
      repoRoot: "/Users/jayant/projects/Zox",
      jobsDir: "/tmp/tb-jobs",
    });
    expect(built.argv).toEqual([
      "harbor",
      "run",
      "--dataset",
      "terminal-bench@2.0",
      "--agent",
      "eval.adapters.harbor.zox_agent:ZoxInstalledAgent",
      "--model",
      "anthropic/claude-sonnet-4-20250514",
      "--include-task-name",
      "openssl-selfsigned-cert",
      "--n-concurrent",
      "1",
      "--jobs-dir",
      "/tmp/tb-jobs",
    ]);
    expect(built.env.ZOX_ROOT).toBe("/Users/jayant/projects/Zox");
    expect(built.env.PYTHONPATH).toBe("/Users/jayant/projects/Zox");
  });

  test("repeats --include-task-name for each smoke task", () => {
    const built = buildHarborRun({
      model: "anthropic/x",
      taskNames: ["openssl-selfsigned-cert", "fix-git"],
      repoRoot: "/tmp/zox",
    });
    expect(built.argv).toContain("fix-git");
    expect(
      built.argv.filter((part) => part === "--include-task-name"),
    ).toHaveLength(2);
  });

  test("missing harbor or docker fails fast", () => {
    expect(() =>
      assertTerminalBenchReady({ harbor: false, docker: true }),
    ).toThrow(/harbor/);
    expect(() =>
      assertTerminalBenchReady({ harbor: true, docker: false }),
    ).toThrow(/Docker/);
  });

  test("runTerminalBench spawns harbor with smoke tasks", async () => {
    const spawned: Array<{ argv: string[]; env: Record<string, string> }> = [];
    const code = await runTerminalBench({
      flags: {
        model: "anthropic/claude-sonnet-4-20250514",
        tasks: ["fix-git"],
        limit: 1,
      },
      repoRoot: "/tmp/zox",
      harbor: true,
      docker: true,
      spawnHarbor: async (cmd) => {
        spawned.push(cmd);
        return { code: 0, stdout: '{"n_resolved":1,"n_trials":1}' };
      },
    });
    expect(code).toBe(0);
    expect(spawned[0]?.argv[0]).toBe("harbor");
    expect(spawned[0]?.argv).toContain("fix-git");
    expect(spawned[0]?.env.ZOX_ROOT).toBe("/tmp/zox");
  });
});

describe("ZoxInstalledAgent source", () => {
  test("installs bun and runs zox agent run with host sandbox", async () => {
    const src = await readFile(
      resolve("eval/adapters/harbor/zox_agent.py"),
      "utf8",
    );
    expect(src).toContain("class ZoxInstalledAgent");
    expect(src).toContain("BaseInstalledAgent");
    expect(src).toContain("agent run");
    expect(src).toContain("--auto-approve");
    expect(src).toContain("--sandbox host");
    expect(src).toContain("ZOX_ROOT");
    expect(src).toContain("bun-linux");
    expect(src).toContain("upload_file");
    expect(src).toContain("agent run .");
    expect(src).not.toContain("bun.sh/install");
    expect(src).toContain("registry.npmjs.org");
    expect(src).toContain("for attempt in range");
  });
});

describe("linux bun cache", () => {
  test("prefers github then npm for the container arch", () => {
    expect(linuxBunSlug("arm64")).toBe("bun-linux-aarch64");
    expect(linuxBunSlug("x86_64")).toBe("bun-linux-x64");
    const urls = linuxBunDownloadUrls("bun-linux-aarch64");
    expect(urls[0]).toContain("github.com/oven-sh/bun");
    expect(urls[1]).toContain("registry.npmjs.org/@oven/bun-linux-aarch64");
  });
});
