import type { SandboxAdapter } from "./adapter.ts";
import { collectSpawnedOutput } from "./collect.ts";
import { allowedContainerEnv, createContainerAdapter } from "./container.ts";
import { inspectArgv } from "./denylist.ts";
import { jailPath } from "./jail.ts";
import { createRemoteAdapter } from "./remote.ts";
import type { SandboxConfig, ToolExecutionResult } from "./types.ts";

const DENIED_EXIT_CODE = -100;

export async function runSandboxed(opts: {
  argv: string[];
  cwd: string;
  config: SandboxConfig;
  env?: Record<string, string>;
  shell?: boolean;
  spawn?: typeof Bun.spawn;
  remoteExec?: SandboxAdapter["exec"];
}): Promise<ToolExecutionResult> {
  const startedAt = performance.now();
  const inspection = inspectArgv(opts.argv, opts.config.denylist, {
    shell: opts.shell ?? false,
  });
  if (inspection.denied) {
    return deniedResult(inspection.reason ?? "command denied", startedAt);
  }

  const skipJail = opts.config.mode === "remote";
  let cwd = opts.cwd;
  if (!skipJail) {
    const jailed = await jailPath(opts.config.root, opts.cwd).catch(() => ({
      ok: false as const,
      reason: "path jail: sandbox root is unavailable",
    }));
    if (!jailed.ok) {
      return deniedResult(jailed.reason, startedAt);
    }
    cwd = jailed.path;
  }

  const execOpts = {
    argv: opts.argv,
    cwd,
    env: opts.env ?? {},
    timeoutMs: opts.config.timeoutMs,
    maxOutputBytes: opts.config.maxOutputBytes,
  };

  if (opts.config.mode === "remote") {
    if (!opts.remoteExec) {
      return deniedResult("remote adapter not configured", startedAt);
    }
    return createRemoteAdapter({ exec: opts.remoteExec }).exec(execOpts);
  }

  if (opts.config.mode === "container") {
    return createContainerAdapter({
      spawn: opts.spawn,
      envAllowlist: opts.config.envAllowlist,
      allowHosts: opts.config.network?.allowHosts,
    }).exec({
      ...execOpts,
      env: allowedContainerEnv(opts.config.envAllowlist, opts.env),
    });
  }

  let subprocess: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    subprocess = Bun.spawn(opts.argv, {
      cwd,
      detached: true,
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

  let termination: Promise<void> | undefined;
  const terminateGroup = (): Promise<void> => {
    termination ??= (async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          globalThis.process.kill(-subprocess.pid, "SIGKILL");
          subprocess.kill("SIGKILL");
          return;
        } catch {
          await Bun.sleep(1);
        }
      }
      subprocess.kill("SIGKILL");
    })();
    return termination;
  };

  return collectSpawnedOutput(subprocess, {
    timeoutMs: opts.config.timeoutMs,
    maxOutputBytes: opts.config.maxOutputBytes,
    startedAt,
    kill: terminateGroup,
  });
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
