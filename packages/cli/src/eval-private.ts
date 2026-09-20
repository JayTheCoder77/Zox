import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { writeJsonFile } from "../../observability/src/json.ts";
import { assertOfficialBenchModel } from "./eval-bench.ts";
import { runWorkspaceAgent } from "./eval-run.ts";
import { formatPrivateAggregate, type TaskTrials } from "./eval-score.ts";
import type { CliFlags } from "./parse.ts";

export const DEFAULT_PRIVATE_TASKS_DIR = "eval/private";
export const DEFAULT_PRIVATE_K = 3;

export type PrivateMeta = {
  budgetMinutes: number;
  tags: string[];
  difficulty: string;
};

export type PrivateAgentResult = {
  pass?: boolean;
  turns: number;
  usd: number | null;
  latencyMs: number;
  toolCalls: number;
  toolFailures: number;
  transcript: string;
};

export type PrivateTrialSummary = {
  taskId: string;
  trial: number;
  pass: boolean;
  turns: number;
  usd: number | null;
  latencyMs: number;
  toolCalls: number;
  toolFailures: number;
};

export async function discoverPrivateTasks(
  tasksDir: string,
): Promise<string[]> {
  const root = resolve(tasksDir);
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const dirs: string[] = [];
  for (const name of names) {
    const dir = join(root, name);
    if (
      existsSync(join(dir, "README.md")) &&
      existsSync(join(dir, "grader.sh"))
    ) {
      dirs.push(dir);
    }
  }
  return dirs;
}

export async function loadPrivateMeta(taskDir: string): Promise<PrivateMeta> {
  const raw = JSON.parse(
    await readFile(join(taskDir, "meta.json"), "utf8"),
  ) as Partial<PrivateMeta>;
  return {
    budgetMinutes: raw.budgetMinutes ?? 15,
    tags: raw.tags ?? [],
    difficulty: raw.difficulty ?? "medium",
  };
}

export async function runPrivateSuite(opts: {
  tasksDir?: string;
  flags?: CliFlags;
  resultsDir?: string;
  runAgent?: (opts: {
    workspace: string;
    task: string;
    flags: CliFlags;
  }) => Promise<PrivateAgentResult>;
}): Promise<PrivateTrialSummary[]> {
  const flags = opts.flags ?? {};
  assertOfficialBenchModel("private eval", flags.model);
  const tasksDir = resolve(opts.tasksDir ?? DEFAULT_PRIVATE_TASKS_DIR);
  const k = flags.k ?? DEFAULT_PRIVATE_K;
  const taskDirs = await discoverPrivateTasks(tasksDir);
  if (taskDirs.length === 0) {
    throw new Error(`no private eval tasks in ${tasksDir}`);
  }
  const resultsRoot = resolve(opts.resultsDir ?? "eval/results/private");
  const runAgent = opts.runAgent ?? runWorkspaceAgent;

  const summaries: PrivateTrialSummary[] = [];
  const byTask: TaskTrials[] = [];

  for (const taskDir of taskDirs) {
    const taskId = basename(taskDir);
    const prompt = await readFile(join(taskDir, "README.md"), "utf8");
    const passes: boolean[] = [];
    const latencyMs: number[] = [];
    const usd: Array<number | null> = [];
    const toolCalls: number[] = [];
    const toolFailures: number[] = [];

    for (let trial = 1; trial <= k; trial++) {
      const workspace = await materializeRepo(taskDir);
      const started = Date.now();
      const agent = await runAgent({ workspace, task: prompt, flags });
      const latency = agent.latencyMs || Date.now() - started;
      const grade = await runGrader(taskDir, workspace);
      const pass = grade;
      const row: PrivateTrialSummary = {
        taskId,
        trial,
        pass,
        turns: agent.turns,
        usd: agent.usd,
        latencyMs: latency,
        toolCalls: agent.toolCalls,
        toolFailures: agent.toolFailures,
      };
      summaries.push(row);
      passes.push(pass);
      latencyMs.push(latency);
      usd.push(agent.usd);
      toolCalls.push(agent.toolCalls);
      toolFailures.push(agent.toolFailures);

      const trialDir = join(resultsRoot, taskId, `trial-${trial}`);
      await mkdir(trialDir, { recursive: true });
      await writeFile(join(trialDir, "transcript.txt"), agent.transcript);
      await writeFile(
        join(trialDir, "patch.diff"),
        await directoryDiff(taskDir, workspace),
      );
      await writeJsonFile(join(trialDir, "summary.json"), row);
    }

    byTask.push({ taskId, passes, latencyMs, usd, toolCalls, toolFailures });
  }

  console.log(formatPrivateAggregate({ tasks: byTask, k }));
  return summaries;
}

async function materializeRepo(taskDir: string): Promise<string> {
  const dest = await mkdtemp(
    join(tmpdir(), `zox-private-${basename(taskDir)}-`),
  );
  const repo = join(taskDir, "repo");
  if (existsSync(repo)) {
    await cp(repo, dest, { recursive: true });
  }
  return dest;
}

async function runGrader(taskDir: string, workspace: string): Promise<boolean> {
  const grader = join(taskDir, "grader.sh");
  const proc = Bun.spawn(["bash", grader, workspace], {
    cwd: taskDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, EVAL_WORKSPACE: workspace },
  });
  const code = await proc.exited;
  return code === 0;
}

async function directoryDiff(
  taskDir: string,
  workspace: string,
): Promise<string> {
  const base = join(taskDir, "repo");
  if (!existsSync(base)) return "";
  const proc = Bun.spawn(["diff", "-ruN", base, workspace], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
}
