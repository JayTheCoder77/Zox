import { inspectArgv } from "./denylist.ts";
import { jailPath } from "./jail.ts";
import { truncateUtf8 } from "./truncate.ts";
import type { SandboxConfig, ToolExecutionResult } from "./types.ts";

const DENIED_EXIT_CODE = -100;
const TIMED_OUT_EXIT_CODE = -101;

export async function runSandboxed(opts: {
  argv: string[];
  cwd: string;
  config: SandboxConfig;
  env?: Record<string, string>;
  shell?: boolean;
}): Promise<ToolExecutionResult> {
  const startedAt = performance.now();
  const inspection = inspectArgv(opts.argv, opts.config.denylist, {
    shell: opts.shell ?? false,
  });
  if (inspection.denied) {
    return deniedResult(inspection.reason ?? "command denied", startedAt);
  }

  const jailed = await jailPath(opts.config.root, opts.cwd).catch(() => ({
    ok: false as const,
    reason: "path jail: sandbox root is unavailable",
  }));
  if (!jailed.ok) {
    return deniedResult(jailed.reason, startedAt);
  }

  let process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    process = Bun.spawn(opts.argv, {
      cwd: jailed.path,
      env: { ...globalThis.process.env, ...opts.env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      truncated: false,
      timedOut: false,
      denied: false,
      durationMs: elapsed(startedAt),
    };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    process.kill();
  }, opts.config.timeoutMs);

  const [exitCode, stdoutText, stderrText] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]).finally(() => clearTimeout(timer));

  const stdout = truncateUtf8(stdoutText, opts.config.maxOutputBytes);
  const stderr = truncateUtf8(stderrText, opts.config.maxOutputBytes);
  return {
    ok: !timedOut && exitCode === 0,
    exitCode: timedOut ? TIMED_OUT_EXIT_CODE : exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    timedOut,
    denied: false,
    durationMs: elapsed(startedAt),
  };
}

function deniedResult(
  denyReason: string,
  startedAt: number,
): ToolExecutionResult {
  return {
    ok: false,
    exitCode: DENIED_EXIT_CODE,
    stdout: "",
    stderr: "",
    truncated: false,
    timedOut: false,
    denied: true,
    denyReason,
    durationMs: elapsed(startedAt),
  };
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
