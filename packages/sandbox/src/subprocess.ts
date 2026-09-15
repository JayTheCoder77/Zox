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

  let subprocess: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    subprocess = Bun.spawn(opts.argv, {
      cwd: jailed.path,
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

  let timedOut = false;
  let outputExceeded = false;
  let remainingOutputBytes = opts.config.maxOutputBytes;
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
  const timer = setTimeout(() => {
    timedOut = true;
    void terminateGroup();
  }, opts.config.timeoutMs);

  const readCapped = async (
    stream: ReadableStream<Uint8Array>,
  ): Promise<Uint8Array[]> => {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return chunks;
        if (outputExceeded) {
          await reader.cancel();
          return chunks;
        }
        if (value.byteLength <= remainingOutputBytes) {
          chunks.push(value);
          remainingOutputBytes -= value.byteLength;
          continue;
        }
        if (remainingOutputBytes > 0) {
          chunks.push(value.subarray(0, remainingOutputBytes));
          remainingOutputBytes = 0;
        }
        outputExceeded = true;
        clearTimeout(timer);
        await terminateGroup();
        await reader.cancel();
        return chunks;
      }
    } finally {
      reader.releaseLock();
    }
  };

  const [exitCode, stdoutChunks, stderrChunks] = await Promise.all([
    subprocess.exited,
    readCapped(subprocess.stdout),
    readCapped(subprocess.stderr),
  ]).finally(() => clearTimeout(timer));

  const stdoutBytes = Buffer.concat(stdoutChunks);
  const stderrBytes = Buffer.concat(stderrChunks);
  const stdout = truncateUtf8(
    stdoutBytes.toString("utf8"),
    stdoutBytes.byteLength,
  );
  const stderr = truncateUtf8(
    stderrBytes.toString("utf8"),
    stderrBytes.byteLength,
  );
  return {
    ok: !timedOut && exitCode === 0,
    exitCode: timedOut ? TIMED_OUT_EXIT_CODE : exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: outputExceeded || stdout.truncated || stderr.truncated,
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
