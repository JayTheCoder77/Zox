import { truncateUtf8 } from "./truncate.ts";
import type { ToolExecutionResult } from "./types.ts";

export const TIMED_OUT_EXIT_CODE = -101;

export async function collectSpawnedOutput(
  subprocess: {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
  },
  opts: {
    timeoutMs: number;
    maxOutputBytes: number;
    startedAt: number;
    kill: () => void | Promise<void>;
  },
): Promise<ToolExecutionResult> {
  let timedOut = false;
  let outputExceeded = false;
  let remainingOutputBytes = opts.maxOutputBytes;
  const timer = setTimeout(() => {
    timedOut = true;
    void opts.kill();
  }, opts.timeoutMs);

  const readCapped = async (
    stream: ReadableStream<Uint8Array> | null,
  ): Promise<Uint8Array[]> => {
    if (!stream) return [];
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
        await opts.kill();
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
    durationMs: elapsed(opts.startedAt),
  };
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
