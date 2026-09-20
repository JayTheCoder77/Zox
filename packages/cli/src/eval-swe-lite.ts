import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runAgentRun } from "./agent-run.ts";
import {
  assertOfficialBenchModel,
  dockerAvailable,
  loadSmokeIds,
  pythonModuleExists,
  resolvePythonWithModule,
  selectSmokeIds,
} from "./eval-bench.ts";
import type { CliFlags } from "./parse.ts";

export {
  assertOfficialBenchModel,
  loadSmokeIds,
  selectSmokeIds,
} from "./eval-bench.ts";

export const DEFAULT_SWE_LITE_MAX_TURNS = 100;
export const SWE_LITE_DATASET = "princeton-nlp/SWE-bench_Lite";
export const SWE_LITE_SMOKE_PATH = resolve(
  "eval/benchmarks/swe-lite-smoke.json",
);
export const SWE_LITE_SUBSET_PATH = resolve(
  "eval/benchmarks/swe-lite-subset.json",
);

export type SweLiteInstance = {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
};

export type SwebenchReport = {
  resolved_ids?: string[];
  completed_ids?: string[];
  unresolved_ids?: string[];
};

export function sweLiteMaxTurns(flags: CliFlags): number {
  return flags.maxTurns ?? DEFAULT_SWE_LITE_MAX_TURNS;
}

export function predictionLine(row: {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}): string {
  return JSON.stringify({
    instance_id: row.instance_id,
    model_name_or_path: row.model_name_or_path,
    model_patch: row.model_patch,
  });
}

export async function collectCachedDiff(cwd: string): Promise<string> {
  const git = ["git", "-C", cwd];
  const exclude = [".", ":(exclude).zox", ":(exclude).zox/**"];
  const add = Bun.spawn([...git, "add", "-A", "--", ...exclude], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const addCode = await add.exited;
  if (addCode !== 0) {
    const err = await new Response(add.stderr).text();
    throw new Error(`git add -A failed: ${err}`);
  }
  const diff = Bun.spawn([...git, "diff", "--cached", "--", ...exclude], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(diff.stdout).text();
  const diffCode = await diff.exited;
  if (diffCode !== 0) {
    const err = await new Response(diff.stderr).text();
    throw new Error(`git diff --cached failed: ${err}`);
  }
  return text;
}

export function buildSwebenchEvalArgv(opts: {
  predictionsPath: string;
  instanceIds: string[];
  runId: string;
  python?: string;
}): string[] {
  return [
    opts.python ?? "python",
    "-m",
    "swebench.harness.run_evaluation",
    "--dataset_name",
    SWE_LITE_DATASET,
    "--predictions_path",
    opts.predictionsPath,
    "--instance_ids",
    ...opts.instanceIds,
    "--run_id",
    opts.runId,
    "--max_workers",
    "1",
  ];
}

export function buildLoadInstancesArgv(
  repoRoot: string,
  ids: string[],
  python = "python",
): string[] {
  return [
    python,
    resolve(repoRoot, "eval/adapters/swebench/load_instances.py"),
    ...ids,
  ];
}

export function buildCloneArgv(repo: string, dest: string): string[] {
  return [
    "git",
    "clone",
    "--filter=blob:none",
    `https://github.com/${repo}.git`,
    dest,
  ];
}

export function assertSweLiteEvalReady(opts: {
  skipEval: boolean;
  docker: boolean;
  swebench: boolean;
}): void {
  if (opts.skipEval) return;
  if (!opts.docker) {
    throw new Error(
      "Docker is required for SWE-bench Lite eval. Install Docker, then retry (or pass --skip-eval).",
    );
  }
  if (!opts.swebench) {
    throw new Error(
      "Python module swebench is required. pip install swebench into the repo .venv or the active VIRTUAL_ENV (or pass --skip-eval).",
    );
  }
}

export function formatSweLiteAggregate(
  report: SwebenchReport,
  extras?: { turns?: number[]; usd?: Array<number | null> },
): string {
  const resolved = report.resolved_ids?.length ?? 0;
  const total =
    report.completed_ids?.length ??
    resolved + (report.unresolved_ids?.length ?? 0);
  const lines = [`pass@1 ${resolved}/${total}`];
  if (extras?.turns) {
    lines.push(`turns ${extras.turns.join(" ")}`);
  }
  if (extras?.usd) {
    lines.push(
      `$ ${extras.usd.map((value) => (value === null ? "n/a" : String(value))).join(" ")}`,
    );
  }
  return lines.join("\n");
}

export type SweLiteRunOpts = {
  flags: CliFlags;
  repoRoot?: string;
  resultsRoot?: string;
  cacheDir?: string;
  runId?: string;
  docker?: boolean;
  swebench?: boolean;
  loadInstances?: (ids: string[]) => Promise<SweLiteInstance[]>;
  cloneCheckout?: (instance: SweLiteInstance, dest: string) => Promise<string>;
  collectDiff?: (cwd: string) => Promise<string>;
  runAgent?: typeof runAgentRun;
  runEval?: (
    argv: string[],
  ) => Promise<{ report: SwebenchReport; ok: boolean }>;
};

export async function runSweLite(opts: SweLiteRunOpts): Promise<number> {
  const flags = opts.flags;
  assertOfficialBenchModel("swe-lite", flags.model);
  const skipEval = Boolean(flags.skipEval);
  const docker = opts.docker ?? (await dockerAvailable());
  const swebench = opts.swebench ?? (await pythonModuleExists("swebench"));
  assertSweLiteEvalReady({ skipEval, docker, swebench });

  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const smoke = await loadSmokeIds(SWE_LITE_SMOKE_PATH, "instance_ids");
  const ids = selectSmokeIds(smoke, flags);
  if (ids.length === 0) {
    throw new Error("swe-lite: no instance ids selected");
  }

  const loadInstances =
    opts.loadInstances ??
    defaultLoadInstances(
      repoRoot,
      (await resolvePythonWithModule("swebench", { repoRoot })) ?? "python",
    );
  const instances = await loadInstances(ids);
  const runId = opts.runId ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
  const resultsDir = resolve(
    opts.resultsRoot ?? "eval/results/swe-lite",
    runId,
  );
  await mkdir(resultsDir, { recursive: true });
  const cacheDir = resolve(opts.cacheDir ?? "eval/benchmarks/cache/swe-lite");
  const cloneCheckout = opts.cloneCheckout ?? defaultCloneCheckout;
  const collectDiff = opts.collectDiff ?? collectCachedDiff;
  const runAgent = opts.runAgent ?? runAgentRun;

  const lines: string[] = [];
  const agentFlags: CliFlags = {
    ...flags,
    sandbox: "host",
    autoApprove: true,
    noTui: true,
    maxTurns: sweLiteMaxTurns(flags),
  };

  for (const instance of instances) {
    const dest = join(cacheDir, instance.instance_id);
    const workspace = await cloneCheckout(instance, dest);
    const agentCode = await runAgent({
      workspace,
      task: instance.problem_statement,
      flags: agentFlags,
    });
    if (agentCode !== 0) {
      console.error(
        `swe-lite agent failed for ${instance.instance_id} (exit ${agentCode})`,
      );
    }
    const patch = await collectDiff(workspace);
    lines.push(
      predictionLine({
        instance_id: instance.instance_id,
        model_name_or_path: flags.model ?? "unknown",
        model_patch: patch,
      }),
    );
  }

  const predictionsPath = join(resultsDir, "predictions.jsonl");
  await writeFile(predictionsPath, `${lines.join("\n")}\n`);
  console.log(`wrote ${predictionsPath}`);

  if (skipEval) {
    return 0;
  }

  const argv = buildSwebenchEvalArgv({
    predictionsPath,
    instanceIds: ids,
    runId,
    python,
  });
  const runEval = opts.runEval ?? defaultRunSwebenchEval;
  let result: { report: SwebenchReport; ok: boolean };
  try {
    result = await runEval(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.log(formatSweLiteAggregate(result.report));
  const resolved = result.report.resolved_ids?.length ?? 0;
  const total = result.report.completed_ids?.length ?? instances.length;
  if (!result.ok || resolved < total) return 1;
  return 0;
}

function defaultLoadInstances(
  repoRoot: string,
  python = "python",
): (ids: string[]) => Promise<SweLiteInstance[]> {
  return async (ids) => {
    const argv = buildLoadInstancesArgv(repoRoot, ids, python);
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(
        `failed to load SWE-bench Lite instances: ${stderr || stdout}`,
      );
    }
    return JSON.parse(stdout) as SweLiteInstance[];
  };
}

async function defaultCloneCheckout(
  instance: SweLiteInstance,
  dest: string,
): Promise<string> {
  const gitDir = join(dest, ".git");
  const hasGit = (await Bun.spawn(["test", "-d", gitDir]).exited) === 0;
  if (!hasGit) {
    await mkdir(resolve(dest, ".."), { recursive: true });
    const clone = Bun.spawn(buildCloneArgv(instance.repo, dest), {
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await clone.exited) !== 0) {
      throw new Error(`git clone failed for ${instance.repo}`);
    }
  }
  const checkout = Bun.spawn(["git", "checkout", instance.base_commit], {
    cwd: dest,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await checkout.exited) !== 0) {
    throw new Error(
      `git checkout ${instance.base_commit} failed for ${instance.instance_id}`,
    );
  }
  return dest;
}

async function defaultRunSwebenchEval(
  argv: string[],
): Promise<{ report: SwebenchReport; ok: boolean }> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `swebench.harness.run_evaluation failed: ${stderr || stdout}`,
    );
  }
  const combined = `${stdout}\n${stderr}`;
  const reportPath = combined.match(/Report written to (\S+)/)?.[1];
  if (reportPath) {
    const report = JSON.parse(
      await readFile(reportPath, "utf8"),
    ) as SwebenchReport;
    return { report, ok: true };
  }
  throw new Error("swebench eval finished but no report path was printed");
}
