#!/usr/bin/env bun
import { runAgentRun } from "./agent-run.ts";
import { runEmbed } from "./embed.ts";
import { DEFAULT_EVAL_TASKS_DIR, runEvalSuite } from "./eval-run.ts";
import { runExportSession } from "./export-session.ts";
import { runHooksTrust } from "./hooks.ts";
import { parseArgs } from "./parse.ts";
import { runServe } from "./serve.ts";

async function main(): Promise<void> {
  const { flags, positionals } = parseArgs(process.argv.slice(2));

  if (positionals[0] === "hooks" && positionals[1] === "trust") {
    await runHooksTrust(flags.workspace);
    return;
  }

  if (positionals[0] === "serve") {
    await runServe(flags);
    return;
  }

  if (positionals[0] === "eval" && positionals[1] === "run") {
    const summaries = await runEvalSuite({
      tasksDir: positionals[2] ?? DEFAULT_EVAL_TASKS_DIR,
      flags,
    });
    if (summaries.some((summary) => !summary.pass)) process.exit(1);
    return;
  }

  if (positionals[0] === "agent" && positionals[1] === "run") {
    const workspace = positionals[2];
    const task = positionals[3];
    if (!workspace || !task) {
      throw new Error("usage: zox agent run <workspace> <task>");
    }
    const code = await runAgentRun({ workspace, task, flags });
    process.exit(code);
  }

  if (positionals[0] === "export" && positionals[1] === "session") {
    const sessionId = positionals[2];
    if (!sessionId) {
      throw new Error("usage: zox export session <id> [--include-memory]");
    }
    await runExportSession({ sessionId, flags });
    return;
  }

  await runEmbed(flags);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
