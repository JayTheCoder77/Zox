import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  evalTaskSchema,
  type EvalRunSummary,
  type EvalTask,
} from "@zox/contracts";
import { writeJsonFile } from "../../observability/src/json.ts";
import { createZoxClient } from "@zox/sdk";
import { listen } from "@zox/server";
import type { CliFlags } from "./parse.ts";

export type { EvalRunSummary, EvalTask };

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
  opts: { resultsDir?: string; flags?: CliFlags } = {},
): Promise<EvalRunSummary> {
  const parsed = evalTaskSchema.parse(task);
  const flags = opts.flags ?? {};
  const model = flags.model ?? parsed.model;
  const workspaceRoot = await materializeWorkspace(parsed);
  const resultsDir = opts.resultsDir ?? resolve("eval/results");

  const summary = await runWithListen(parsed, workspaceRoot, model, flags);

  await writeJsonFile(join(resultsDir, `${parsed.id}.json`), summary);
  return summary;
}

export async function runEvalSuite(opts: {
  tasksDir?: string;
  flags?: CliFlags;
  resultsDir?: string;
}): Promise<EvalRunSummary[]> {
  const tasksDir = resolve(opts.tasksDir ?? "eval/tasks");
  const files = (await readdir(tasksDir))
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
  const summaries: EvalRunSummary[] = [];
  for (const file of files) {
    const raw = await readFile(join(tasksDir, file), "utf8");
    const task = evalTaskSchema.parse(Bun.YAML.parse(raw));
    summaries.push(
      await runEvalTask(task, {
        flags: opts.flags,
        resultsDir: opts.resultsDir,
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
): Promise<EvalRunSummary> {
  const token = flags.token ?? process.env.ZOXX_SERVER_TOKEN ?? crypto.randomUUID();
  const server = await listen({
    hostname: "127.0.0.1",
    port: flags.port ?? 0,
    sandboxMode: flags.sandbox ?? "host",
    workspaceRoot,
    token,
  });
  try {
    return await executeTask({
      baseUrl: `http://127.0.0.1:${server.port}`,
      token,
      workspaceRoot,
      model,
      task,
    });
  } finally {
    server.stop();
  }
}

async function executeTask(opts: {
  baseUrl: string;
  token: string;
  workspaceRoot: string;
  model: string;
  task: EvalTask;
}): Promise<EvalRunSummary> {
  const client = createZoxClient({
    baseUrl: opts.baseUrl,
    token: opts.token,
  });
  const session = await client.sessions.create({
    workspaceRoot: opts.workspaceRoot,
    agent: "build",
    model: opts.model,
  });
  const run = session.send(opts.task.prompt);
  let stdout = "";
  let turns = 0;
  let usdSum = 0;
  let hasUsd = false;

  for await (const event of run.events()) {
    if (event.type === "message.delta") stdout += event.delta;
    else if (event.type === "message.completed" && stdout.length === 0) {
      stdout = event.content;
    }
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

  const stdoutOk =
    opts.task.expect.stdoutIncludes === undefined ||
    stdout.includes(opts.task.expect.stdoutIncludes);
  const filesOk = await expectedFilesOk(
    opts.workspaceRoot,
    opts.task.expect.files,
  );

  return {
    taskId: opts.task.id,
    pass: stdoutOk && filesOk,
    turns,
    usd: hasUsd ? usdSum : null,
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
