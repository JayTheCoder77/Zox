import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type EvalRunSummary,
  type EvalTask,
  evalTaskSchema,
} from "@zox/contracts";
import { createZoxClient } from "@zox/sdk";
import { listen } from "@zox/server";
import { writeJsonFile } from "../../observability/src/json.ts";
import type { CliFlags } from "./parse.ts";

export type { EvalRunSummary, EvalTask };

export const DEFAULT_EVAL_TASKS_DIR = "eval/tasks/mock";
export const DEFAULT_LIVE_EVAL_MAX_TURNS = 50;
export const DEFAULT_EVAL_TIMEOUT_MS = 5 * 60 * 1000;

export function isLiveEvalDir(tasksDir: string): boolean {
  return resolve(tasksDir).replaceAll("\\", "/").endsWith("/eval/tasks/live");
}

export function assertLiveEvalReady(
  tasksDir: string,
  flags: CliFlags = {},
): void {
  if (!isLiveEvalDir(tasksDir)) return;
  const model = flags.model;
  if (!model) {
    throw new Error("live evals require --model <provider/id>");
  }
  if (model.startsWith("mock/")) {
    throw new Error("live evals reject mock models; pass a real --model");
  }
}

export function evalSandboxMode(
  live: boolean,
  flags: CliFlags,
): NonNullable<CliFlags["sandbox"]> {
  if (flags.sandbox) return flags.sandbox;
  return live ? "worktree" : "host";
}

export function evalMaxTurns(
  live: boolean,
  flags: CliFlags,
): number | undefined {
  if (flags.maxTurns !== undefined) return flags.maxTurns;
  return live ? DEFAULT_LIVE_EVAL_MAX_TURNS : undefined;
}

export function failedEvalSummary(taskId: string): EvalRunSummary {
  return { taskId, pass: false, turns: 0, usd: null };
}

export async function withEvalTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function formatEvalAggregate(summaries: EvalRunSummary[]): string {
  const passed = summaries.filter((summary) => summary.pass).length;
  const turns = summaries
    .map((summary) => `${summary.taskId}=${summary.turns}`)
    .join(" ");
  const usd = summaries
    .map(
      (summary) =>
        `${summary.taskId}=${summary.usd === null ? "n/a" : String(summary.usd)}`,
    )
    .join(" ");
  return `pass@1 ${passed}/${summaries.length}\nturns/task ${turns}\n$/task ${usd}`;
}

export async function runEvalTask(
  task: EvalTask,
  opts: { resultsDir?: string; flags?: CliFlags; live?: boolean } = {},
): Promise<EvalRunSummary> {
  const parsed = evalTaskSchema.parse(task);
  const flags = opts.flags ?? {};
  const model = flags.model ?? parsed.model;
  const workspaceRoot = await materializeWorkspace(parsed);
  const resultsDir = opts.resultsDir ?? resolve("eval/results");
  const live = opts.live ?? false;

  const summary = await runWithListen(
    parsed,
    workspaceRoot,
    model,
    flags,
    live,
  );

  await writeJsonFile(join(resultsDir, `${parsed.id}.json`), summary);
  return summary;
}

export async function runEvalSuite(opts: {
  tasksDir?: string;
  flags?: CliFlags;
  resultsDir?: string;
}): Promise<EvalRunSummary[]> {
  const flags = opts.flags ?? {};
  const tasksDir = resolve(opts.tasksDir ?? DEFAULT_EVAL_TASKS_DIR);
  assertLiveEvalReady(tasksDir, flags);
  const live = isLiveEvalDir(tasksDir);
  const files = (await readdir(tasksDir))
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no eval tasks in ${tasksDir}`);
  }
  const summaries: EvalRunSummary[] = [];
  for (const file of files) {
    const raw = await readFile(join(tasksDir, file), "utf8");
    const task = evalTaskSchema.parse(Bun.YAML.parse(raw));
    summaries.push(
      await runEvalTask(task, {
        flags,
        resultsDir: opts.resultsDir,
        live,
      }),
    );
  }
  console.log(formatEvalAggregate(summaries));
  return summaries;
}

async function materializeWorkspace(task: EvalTask): Promise<string> {
  const dest = await mkdtemp(join(tmpdir(), `zox-eval-${task.id}-`));
  const fixtureDir = resolve("eval/fixtures", task.id);
  const source = task.workspace ? resolve(task.workspace) : fixtureDir;
  if (existsSync(source)) {
    await cp(source, dest, { recursive: true });
  }
  return dest;
}

async function runWithListen(
  task: EvalTask,
  workspaceRoot: string,
  model: string,
  flags: CliFlags,
  live: boolean,
): Promise<EvalRunSummary> {
  const token =
    flags.token ?? process.env.ZOXX_SERVER_TOKEN ?? crypto.randomUUID();
  const maxTurns = evalMaxTurns(live, flags);
  const timeoutMs = flags.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
  const server = await listen({
    hostname: "127.0.0.1",
    port: flags.port ?? 0,
    sandboxMode: evalSandboxMode(live, flags),
    workspaceRoot,
    token,
    budget: maxTurns === undefined ? undefined : { maxTurns },
  });
  try {
    const work = executeTask({
      baseUrl: `http://127.0.0.1:${server.port}`,
      token,
      workspaceRoot,
      model,
      task,
    }).catch(() => failedEvalSummary(task.id));
    return await withEvalTimeout(work, timeoutMs, failedEvalSummary(task.id));
  } finally {
    server.stop();
  }
}

export type WorkspaceAgentResult = {
  stdout: string;
  transcript: string;
  turns: number;
  usd: number | null;
  latencyMs: number;
  toolCalls: number;
  toolFailures: number;
};

export async function runWorkspaceAgent(opts: {
  workspace: string;
  task: string;
  flags: CliFlags;
}): Promise<WorkspaceAgentResult> {
  const flags = opts.flags;
  const token =
    flags.token ?? process.env.ZOXX_SERVER_TOKEN ?? crypto.randomUUID();
  const maxTurns = flags.maxTurns;
  const timeoutMs = flags.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
  const started = Date.now();
  const server = await listen({
    hostname: "127.0.0.1",
    port: flags.port ?? 0,
    sandboxMode: flags.sandbox ?? "worktree",
    workspaceRoot: opts.workspace,
    token,
    budget: maxTurns === undefined ? undefined : { maxTurns },
  });
  try {
    const work = driveAgentSession({
      baseUrl: `http://127.0.0.1:${server.port}`,
      token,
      workspaceRoot: opts.workspace,
      model: flags.model ?? "mock/echo",
      prompt: opts.task,
    }).catch(
      (): WorkspaceAgentResult => ({
        stdout: "",
        transcript: "",
        turns: 0,
        usd: null,
        latencyMs: Date.now() - started,
        toolCalls: 0,
        toolFailures: 0,
      }),
    );
    const result = await withEvalTimeout(work, timeoutMs, {
      stdout: "",
      transcript: "",
      turns: 0,
      usd: null,
      latencyMs: Date.now() - started,
      toolCalls: 0,
      toolFailures: 0,
    });
    return { ...result, latencyMs: Date.now() - started };
  } finally {
    server.stop();
  }
}

async function driveAgentSession(opts: {
  baseUrl: string;
  token: string;
  workspaceRoot: string;
  model: string;
  prompt: string;
}): Promise<WorkspaceAgentResult> {
  const client = createZoxClient({
    baseUrl: opts.baseUrl,
    token: opts.token,
  });
  const session = await client.sessions.create({
    workspaceRoot: opts.workspaceRoot,
    agent: "build",
    model: opts.model,
  });
  const run = session.send(opts.prompt);
  let stdout = "";
  let transcript = "";
  let turns = 0;
  let usdSum = 0;
  let hasUsd = false;
  let toolCalls = 0;
  let toolFailures = 0;
  const started = Date.now();

  for await (const event of run.events()) {
    if (event.type === "message.delta") stdout += event.delta;
    else if (event.type === "message.completed") {
      if (stdout.length === 0) stdout = event.content;
      transcript += `${event.content}\n`;
    }
    if (event.type === "tool.started") {
      toolCalls += 1;
      transcript += `[tool ${event.name}]\n`;
    }
    if (event.type === "tool.completed" && !event.ok) toolFailures += 1;
    if (event.type === "usage.turn") {
      turns += 1;
      if (typeof event.estimatedUsd === "number") {
        hasUsd = true;
        usdSum += event.estimatedUsd;
      }
    }
    if (event.type === "tool.permission_required") {
      await run.respondPermission(event.requestId, { approved: true });
    }
  }

  await session.close();
  if (!transcript) transcript = stdout;

  return {
    stdout,
    transcript,
    turns,
    usd: hasUsd ? usdSum : null,
    latencyMs: Date.now() - started,
    toolCalls,
    toolFailures,
  };
}

async function executeTask(opts: {
  baseUrl: string;
  token: string;
  workspaceRoot: string;
  model: string;
  task: EvalTask;
}): Promise<EvalRunSummary> {
  const started = Date.now();
  const agent = await driveAgentSession({
    baseUrl: opts.baseUrl,
    token: opts.token,
    workspaceRoot: opts.workspaceRoot,
    model: opts.model,
    prompt: opts.task.prompt,
  });
  const stdoutOk =
    opts.task.expect.stdoutIncludes === undefined ||
    agent.stdout.includes(opts.task.expect.stdoutIncludes);
  const filesOk = await expectedFilesOk(
    opts.workspaceRoot,
    opts.task.expect.files,
  );

  return {
    taskId: opts.task.id,
    pass: stdoutOk && filesOk,
    turns: agent.turns,
    usd: agent.usd,
    latencyMs: Date.now() - started,
    toolCalls: agent.toolCalls,
    toolFailures: agent.toolFailures,
  };
}

async function expectedFilesOk(
  workspaceRoot: string,
  files: Array<{ path: string; contains: string }> | undefined,
): Promise<boolean> {
  if (!files || files.length === 0) return true;
  for (const file of files) {
    try {
      const content = await readFile(join(workspaceRoot, file.path), "utf8");
      if (!content.includes(file.contains)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
