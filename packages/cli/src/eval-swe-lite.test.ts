import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pythonCandidates, resolvePythonWithModule } from "./eval-bench.ts";
import {
  assertOfficialBenchModel,
  assertSweLiteEvalReady,
  buildCloneArgv,
  buildLoadInstancesArgv,
  buildSwebenchEvalArgv,
  collectCachedDiff,
  DEFAULT_SWE_LITE_MAX_TURNS,
  formatSweLiteAggregate,
  loadSmokeIds,
  predictionLine,
  runSweLite,
  SWE_LITE_DATASET,
  SWE_LITE_SMOKE_PATH,
  SWE_LITE_SUBSET_PATH,
  selectSmokeIds,
  sweLiteMaxTurns,
} from "./eval-swe-lite.ts";

async function initGitRepo(prefix: string): Promise<string> {
  await mkdir(resolve("eval/benchmarks/cache"), { recursive: true });
  const dir = await mkdtemp(join(resolve("eval/benchmarks/cache"), prefix));
  const init = await Bun.spawn(["git", "init", dir], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
  expect(init).toBe(0);
  const git = ["git", "-C", dir];
  expect(
    await Bun.spawn([...git, "config", "user.email", "eval@zox.dev"], {
      stdout: "ignore",
    }).exited,
  ).toBe(0);
  expect(
    await Bun.spawn([...git, "config", "user.name", "zox"], {
      stdout: "ignore",
    }).exited,
  ).toBe(0);
  await writeFile(join(dir, "keep.txt"), "keep\n");
  expect(
    await Bun.spawn([...git, "add", "keep.txt"], { stdout: "ignore" }).exited,
  ).toBe(0);
  expect(
    await Bun.spawn([...git, "commit", "-m", "init"], { stdout: "ignore" })
      .exited,
  ).toBe(0);
  return dir;
}

describe("assertOfficialBenchModel", () => {
  test("requires --model", () => {
    expect(() => assertOfficialBenchModel("swe-lite", undefined)).toThrow(
      "swe-lite requires --model <provider/id>",
    );
  });

  test("rejects mock models", () => {
    expect(() => assertOfficialBenchModel("swe-lite", "mock/echo")).toThrow(
      "swe-lite reject mock models; pass a real --model",
    );
  });
});

describe("smoke ids", () => {
  test("loads default ids from eval/benchmarks/swe-lite-smoke.json", async () => {
    const ids = await loadSmokeIds(SWE_LITE_SMOKE_PATH, "instance_ids");
    expect(ids).toEqual([
      "django__django-11099",
      "sympy__sympy-20590",
      "astropy__astropy-12907",
    ]);
  });

  test("documents the fixed 10-id comparable subset", async () => {
    const ids = await loadSmokeIds(SWE_LITE_SUBSET_PATH, "instance_ids");
    expect(ids).toHaveLength(10);
    expect(ids).toContain("flask__flask-4045");
    expect(ids).toContain("requests__requests-2317");
  });

  test("defaults to first --limit smoke ids", () => {
    expect(selectSmokeIds(["a", "b", "c"], { limit: 2 })).toEqual(["a", "b"]);
  });

  test("uses --instance-id over smoke list", () => {
    expect(
      selectSmokeIds(["a", "b", "c"], {
        instanceIds: ["psf__requests-2317"],
        limit: 3,
      }),
    ).toEqual(["psf__requests-2317"]);
  });
});

describe("predictions jsonl", () => {
  test("serializes instance_id, model_name_or_path, model_patch", () => {
    const line = predictionLine({
      instance_id: "django__django-11099",
      model_name_or_path: "anthropic/claude-sonnet-4-20250514",
      model_patch: "diff --git a/x b/x\n",
    });
    expect(JSON.parse(line)).toEqual({
      instance_id: "django__django-11099",
      model_name_or_path: "anthropic/claude-sonnet-4-20250514",
      model_patch: "diff --git a/x b/x\n",
    });
  });

  test("empty patch is an empty string", () => {
    expect(
      JSON.parse(
        predictionLine({
          instance_id: "x",
          model_name_or_path: "m",
          model_patch: "",
        }),
      ).model_patch,
    ).toBe("");
  });
});

describe("collectCachedDiff", () => {
  test("returns empty string for a clean repo", async () => {
    const dir = await initGitRepo("zox-swe-empty-");
    expect(await collectCachedDiff(dir)).toBe("");
  });

  test("returns a unified diff for staged worktree edits", async () => {
    const dir = await initGitRepo("zox-swe-diff-");
    await writeFile(join(dir, "keep.txt"), "changed\n");
    const diff = await collectCachedDiff(dir);
    expect(diff).toContain("keep.txt");
    expect(diff).toContain("+changed");
  });

  test("omits .zox sidecar files from the official patch", async () => {
    const dir = await initGitRepo("zox-swe-zoxdir-");
    await mkdir(join(dir, ".zox"), { recursive: true });
    await writeFile(join(dir, ".zox", "state.sqlite"), "sqlite");
    await writeFile(join(dir, "keep.txt"), "changed\n");
    const diff = await collectCachedDiff(dir);
    expect(diff).toContain("keep.txt");
    expect(diff).not.toContain(".zox");
  });
});

describe("swebench argv", () => {
  test("builds official run_evaluation command", () => {
    const argv = buildSwebenchEvalArgv({
      predictionsPath: "eval/results/swe-lite/run1/predictions.jsonl",
      instanceIds: ["django__django-11099"],
      runId: "run1",
    });
    expect(argv).toEqual([
      "python",
      "-m",
      "swebench.harness.run_evaluation",
      "--dataset_name",
      SWE_LITE_DATASET,
      "--predictions_path",
      "eval/results/swe-lite/run1/predictions.jsonl",
      "--instance_ids",
      "django__django-11099",
      "--run_id",
      "run1",
      "--max_workers",
      "1",
    ]);
  });

  test("builds dataset loader argv without vendoring rows", () => {
    expect(
      buildLoadInstancesArgv(resolve("."), ["django__django-11099"]),
    ).toEqual([
      "python",
      resolve("eval/adapters/swebench/load_instances.py"),
      "django__django-11099",
    ]);
  });

  test("eval argv can use a venv python", () => {
    expect(
      buildSwebenchEvalArgv({
        predictionsPath: "p.jsonl",
        instanceIds: ["x"],
        runId: "r",
        python: "/repo/.venv/bin/python",
      })[0],
    ).toBe("/repo/.venv/bin/python");
  });

  test("clone uses blob filter and github url", () => {
    expect(buildCloneArgv("pallets/flask", "/tmp/flask")).toEqual([
      "git",
      "clone",
      "--filter=blob:none",
      "https://github.com/pallets/flask.git",
      "/tmp/flask",
    ]);
  });
});

describe("eval policy", () => {
  test("default max turns is 100", () => {
    expect(DEFAULT_SWE_LITE_MAX_TURNS).toBe(100);
    expect(sweLiteMaxTurns({})).toBe(100);
    expect(sweLiteMaxTurns({ maxTurns: 12 })).toBe(12);
  });

  test("skip-eval does not require docker or swebench", () => {
    expect(() =>
      assertSweLiteEvalReady({
        skipEval: true,
        docker: false,
        swebench: false,
      }),
    ).not.toThrow();
  });

  test("eval requires docker and swebench", () => {
    expect(() =>
      assertSweLiteEvalReady({
        skipEval: false,
        docker: false,
        swebench: true,
      }),
    ).toThrow(/Docker/);
    expect(() =>
      assertSweLiteEvalReady({
        skipEval: false,
        docker: true,
        swebench: false,
      }),
    ).toThrow(/swebench/);
  });

  test("formats pass@1 from official report", () => {
    expect(
      formatSweLiteAggregate(
        { resolved_ids: ["a"], completed_ids: ["a", "b"] },
        { turns: [3, 4], usd: [null, null] },
      ),
    ).toContain("pass@1 1/2");
  });

  test("prefers repo .venv python over system python3", async () => {
    expect(pythonCandidates("/repo", {})).toContain("/repo/.venv/bin/python");
    const bin = await resolvePythonWithModule("swebench", {
      repoRoot: "/repo",
      tryImport: async (candidate) => candidate === "/repo/.venv/bin/python",
    });
    expect(bin).toBe("/repo/.venv/bin/python");
  });

  test("missing python bins are skipped instead of throwing ENOENT", async () => {
    const bin = await resolvePythonWithModule("swebench", {
      repoRoot: "/no-such-zox-eval-root",
      env: {},
    });
    expect(bin === undefined || typeof bin === "string").toBe(true);
  });
});

describe("runSweLite", () => {
  test("skip-eval writes predictions.jsonl without swebench", async () => {
    const resultsRoot = await mkdtemp(join(tmpdir(), "zox-swe-results-"));
    const code = await runSweLite({
      flags: {
        model: "anthropic/claude-sonnet-4-20250514",
        skipEval: true,
        instanceIds: ["django__django-11099"],
        limit: 1,
      },
      resultsRoot,
      runId: "run1",
      docker: false,
      swebench: false,
      loadInstances: async () => [
        {
          instance_id: "django__django-11099",
          repo: "django/django",
          base_commit: "abc",
          problem_statement: "fix django",
        },
      ],
      cloneCheckout: async () => "/tmp/clone",
      collectDiff: async () => "diff --git a/x b/x\n",
      runAgent: async ({ task, flags }) => {
        expect(task).toBe("fix django");
        expect(flags.sandbox).toBe("host");
        expect(flags.autoApprove).toBe(true);
        expect(flags.maxTurns).toBe(100);
        return 0;
      },
    });
    expect(code).toBe(0);
    const jsonl = await readFile(
      join(resultsRoot, "run1", "predictions.jsonl"),
      "utf8",
    );
    expect(JSON.parse(jsonl.trim())).toMatchObject({
      instance_id: "django__django-11099",
      model_patch: "diff --git a/x b/x\n",
    });
  });

  test("logs when the agent returns non-zero instead of hiding it", async () => {
    const resultsRoot = await mkdtemp(join(tmpdir(), "zox-swe-results-"));
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      await runSweLite({
        flags: {
          model: "anthropic/claude-sonnet-4-20250514",
          skipEval: true,
          instanceIds: ["django__django-11099"],
          limit: 1,
        },
        resultsRoot,
        runId: "run-fail",
        docker: false,
        swebench: false,
        loadInstances: async () => [
          {
            instance_id: "django__django-11099",
            repo: "django/django",
            base_commit: "abc",
            problem_statement: "fix django",
          },
        ],
        cloneCheckout: async () => "/tmp/clone",
        collectDiff: async () => "",
        runAgent: async () => 1,
      });
    } finally {
      console.error = original;
    }
    expect(errors.some((line) => line.includes("django__django-11099"))).toBe(
      true,
    );
  });
});
