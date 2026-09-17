import type { SandboxAdapter } from "./adapter.ts";
import { collectSpawnedOutput } from "./collect.ts";
import type { ToolExecutionResult } from "./types.ts";

const DENIED_EXIT_CODE = -100;
const DEFAULT_IMAGE = "docker.io/library/node:22-bookworm";
const DEFAULT_DOCKER_BIN = "docker";
export const DEFAULT_ENV_ALLOWLIST = ["PATH", "HOME", "LANG", "USER"] as const;

export function createContainerAdapter(opts: {
  image?: string;
  dockerBin?: string;
  spawn?: typeof Bun.spawn;
  envAllowlist?: string[];
  allowHosts?: string[];
}): SandboxAdapter {
  const image = opts.image ?? DEFAULT_IMAGE;
  const dockerBin = opts.dockerBin ?? DEFAULT_DOCKER_BIN;
  const spawnImpl = opts.spawn ?? Bun.spawn;
  const envAllowlist = opts.envAllowlist ?? [...DEFAULT_ENV_ALLOWLIST];
  const allowHosts = opts.allowHosts ?? [];

  return {
    mode: "container",
    async exec(execOpts) {
      if (spawnImpl === Bun.spawn && !Bun.which(dockerBin)) {
        return dockerUnavailable();
      }

      const dockerArgv = buildDockerArgv({
        dockerBin,
        image,
        sandboxRoot: execOpts.cwd,
        argv: execOpts.argv,
        env: execOpts.env,
        envAllowlist,
        allowHosts,
      });

      const startedAt = performance.now();
      let subprocess: {
        pid: number;
        exited: Promise<number>;
        stdout: ReadableStream<Uint8Array> | null;
        stderr: ReadableStream<Uint8Array> | null;
        kill: (signal?: string) => void;
      };
      try {
        subprocess = spawnImpl(dockerArgv, {
          cwd: execOpts.cwd,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }) as typeof subprocess;
      } catch (error) {
        if (isMissingBinary(error)) return dockerUnavailable();
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

      return await collectSpawnedOutput(subprocess, {
        timeoutMs: execOpts.timeoutMs,
        maxOutputBytes: execOpts.maxOutputBytes,
        startedAt,
        kill: () => {
          try {
            subprocess.kill("SIGKILL");
          } catch {
            // ignore
          }
        },
      });
    },
  };
}

export function buildDockerArgv(opts: {
  dockerBin: string;
  image: string;
  sandboxRoot: string;
  argv: string[];
  env: Record<string, string>;
  envAllowlist: string[];
  allowHosts: string[];
}): string[] {
  const argv = [
    opts.dockerBin,
    "run",
    "--rm",
    "-v",
    `${opts.sandboxRoot}:/workspace:rw`,
    "-w",
    "/workspace",
  ];
  if (opts.allowHosts.length === 0) {
    argv.push("--network", "none");
  }
  const stripped = allowedContainerEnv(opts.envAllowlist, opts.env);
  for (const [key, value] of Object.entries(stripped)) {
    argv.push("-e", `${key}=${value}`);
  }
  argv.push(opts.image, ...opts.argv);
  return argv;
}

export function allowedContainerEnv(
  allowlist: string[] | undefined,
  overlay?: Record<string, string>,
): Record<string, string> {
  const keys = allowlist ?? [...DEFAULT_ENV_ALLOWLIST];
  const merged = { ...stringProcessEnv(), ...overlay };
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = merged[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function stringProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(globalThis.process.env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function dockerUnavailable(): ToolExecutionResult {
  return {
    ok: false,
    exitCode: DENIED_EXIT_CODE,
    stdout: "",
    stderr: "",
    truncated: false,
    timedOut: false,
    denied: true,
    denyReason: "docker unavailable",
    durationMs: 0,
  };
}

function isMissingBinary(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string };
  if (err.code === "ENOENT") return true;
  return /not found|ENOENT|cannot find/i.test(err.message ?? "");
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
