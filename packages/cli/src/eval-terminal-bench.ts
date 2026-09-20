import { resolve } from "node:path";
import {
  assertOfficialBenchModel,
  commandExists,
  dockerAvailable,
  loadSmokeIds,
  selectSmokeIds,
} from "./eval-bench.ts";
import type { CliFlags } from "./parse.ts";

export {
  assertOfficialBenchModel,
  loadSmokeIds,
  selectSmokeIds,
} from "./eval-bench.ts";

export const TERMINAL_BENCH_SMOKE_PATH = resolve(
  "eval/benchmarks/terminal-bench-smoke.json",
);
export const HARBOR_AGENT = "eval.adapters.harbor.zox_agent:ZoxInstalledAgent";
export const TERMINAL_BENCH_DATASET = "terminal-bench@2.0";

export const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "XAI_API_KEY",
] as const;

export function assertTerminalBenchReady(opts: {
  harbor: boolean;
  docker: boolean;
}): void {
  if (!opts.harbor) {
    throw new Error(
      "harbor is required for Terminal-Bench. pip install harbor or uv tool install harbor",
    );
  }
  if (!opts.docker) {
    throw new Error(
      "Docker is required for Terminal-Bench. Install Docker, then retry.",
    );
  }
}

export function buildHarborRun(opts: {
  model: string;
  taskNames: string[];
  repoRoot: string;
  jobsDir?: string;
  extraEnv?: Record<string, string>;
  nAttempts?: number;
}): { argv: string[]; env: Record<string, string> } {
  const argv = [
    "harbor",
    "run",
    "--dataset",
    TERMINAL_BENCH_DATASET,
    "--agent",
    HARBOR_AGENT,
    "--model",
    opts.model,
  ];
  for (const name of opts.taskNames) {
    argv.push("--include-task-name", name);
  }
  argv.push("--n-concurrent", "1");
  if (opts.nAttempts && opts.nAttempts > 1) {
    argv.push("--n-attempts", String(opts.nAttempts));
  }
  const jobsDir =
    opts.jobsDir ?? resolve(opts.repoRoot, "eval/results/terminal-bench");
  argv.push("--jobs-dir", jobsDir);
  const extraEnv = opts.extraEnv ?? {};
  for (const [key, value] of Object.entries(extraEnv)) {
    argv.push("--agent-env", `${key}=${value}`);
  }
  return {
    argv,
    env: {
      ZOX_ROOT: opts.repoRoot,
      PYTHONPATH: opts.repoRoot,
      ...extraEnv,
    },
  };
}

export function parseHarborSummary(stdout: string): {
  resolved: number;
  total: number;
} {
  const nResolved = stdout.match(/"n_resolved"\s*:\s*(\d+)/);
  const nTrials = stdout.match(/"n_trials"\s*:\s*(\d+)/);
  if (nResolved && nTrials) {
    return {
      resolved: Number(nResolved[1]),
      total: Number(nTrials[1]),
    };
  }
  const table = stdout.match(
    /Trials[\s\S]*?│\s*(\d+)\s*│\s*(\d+)\s*│\s*([\d.]+)\s*│/,
  );
  if (table) {
    const trials = Number(table[1]);
    const exceptions = Number(table[2]);
    return { resolved: trials, total: trials + exceptions };
  }
  throw new Error("unable to parse Harbor results");
}

export type TerminalBenchRunOpts = {
  flags: CliFlags;
  repoRoot?: string;
  harbor?: boolean;
  docker?: boolean;
  spawnHarbor?: (opts: {
    argv: string[];
    env: Record<string, string>;
  }) => Promise<{ code: number; stdout: string }>;
};

export async function runTerminalBench(
  opts: TerminalBenchRunOpts,
): Promise<number> {
  const flags = opts.flags;
  assertOfficialBenchModel("terminal-bench", flags.model);
  const harbor = opts.harbor ?? (await commandExists("harbor"));
  const docker = opts.docker ?? (await dockerAvailable());
  assertTerminalBenchReady({ harbor, docker });

  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const smoke = await loadSmokeIds(TERMINAL_BENCH_SMOKE_PATH, "task_names");
  const taskNames = selectSmokeIds(smoke, flags);
  if (taskNames.length === 0) {
    throw new Error("terminal-bench: no tasks selected");
  }

  const extraEnv: Record<string, string> = {};
  for (const key of PROVIDER_ENV_KEYS) {
    const value = process.env[key];
    if (value) extraEnv[key] = value;
  }
  extraEnv.ZOX_ROOT = repoRoot;
  const built = buildHarborRun({
    model: flags.model ?? "",
    taskNames,
    repoRoot,
    jobsDir: flags.jobsDir,
    extraEnv,
    nAttempts: flags.k,
  });
  const spawnHarbor = opts.spawnHarbor ?? defaultSpawnHarbor;
  const result = await spawnHarbor(built);
  if (result.stdout.trim()) console.log(result.stdout.trimEnd());
  if (result.code !== 0) return 1;
  let summary: { resolved: number; total: number };
  try {
    summary = parseHarborSummary(result.stdout);
  } catch {
    console.error("unable to parse Harbor results");
    return 1;
  }
  console.log(`pass@1 ${summary.resolved}/${summary.total}`);
  if (summary.resolved < summary.total) return 1;
  return 0;
}

async function defaultSpawnHarbor(opts: {
  argv: string[];
  env: Record<string, string>;
}): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(opts.argv, {
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout: `${stdout}\n${stderr}` };
}
