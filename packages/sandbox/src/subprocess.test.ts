import { describe, expect, test } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SANDBOX_CONFIG } from "./defaults.ts";
import { runSandboxed } from "./subprocess.ts";

describe("runSandboxed", () => {
  test("captures stdout and exit 0", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const result = await runSandboxed({
      argv: ["echo", "hello"],
      cwd: root,
      config: { ...DEFAULT_SANDBOX_CONFIG, root },
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.denied).toBe(false);
  });

  test("refuses denylisted executables with sentinel -100", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const result = await runSandboxed({
      argv: ["rm", "-rf", join(root, "x")],
      cwd: root,
      config: { ...DEFAULT_SANDBOX_CONFIG, root },
    });
    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(-100);
    expect(result.ok).toBe(false);
  });

  test("refuses a cwd outside the sandbox root", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-root-"));
    const outside = await mkdtemp(join(tmpdir(), "zox-sub-outside-"));
    const result = await runSandboxed({
      argv: ["echo", "hello"],
      cwd: outside,
      config: { ...DEFAULT_SANDBOX_CONFIG, root },
    });
    expect(result.denied).toBe(true);
    expect(result.exitCode).toBe(-100);
    expect(result.denyReason).toMatch(/jail/i);
  });

  test("times out with sentinel -101", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const result = await runSandboxed({
      argv: ["sleep", "2"],
      cwd: root,
      config: { ...DEFAULT_SANDBOX_CONFIG, root, timeoutMs: 50 },
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-101);
  });

  test("truncates stdout at maxOutputBytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const blob = "x".repeat(1000);
    await Bun.write(join(root, "big.txt"), blob);
    const result = await runSandboxed({
      argv: ["cat", join(root, "big.txt")],
      cwd: root,
      config: { ...DEFAULT_SANDBOX_CONFIG, root, maxOutputBytes: 20 },
    });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(20);
  });

  test("caps combined output while the subprocess is still running", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const scriptPath = join(root, "cap-output.sh");
    await Bun.write(
      scriptPath,
      "printf '1234567890123456'\nprintf 'abcdefghijklmnop' >&2\nwhile :; do :; done\n",
    );
    const result = await runSandboxed({
      argv: ["bash", scriptPath],
      cwd: root,
      config: {
        ...DEFAULT_SANDBOX_CONFIG,
        root,
        maxOutputBytes: 20,
        timeoutMs: 500,
      },
    });
    expect(result.truncated).toBe(true);
    expect(
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
    ).toBeLessThanOrEqual(20);
    expect(result.timedOut).toBe(false);
  });

  test("kills subprocess descendants on timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const marker = join(root, "escaped");
    const scriptPath = join(root, "spawn-descendant.sh");
    await Bun.write(scriptPath, "(sleep 0.4; touch escaped) &\nwait\n");
    const result = await runSandboxed({
      argv: ["bash", scriptPath],
      cwd: root,
      config: { ...DEFAULT_SANDBOX_CONFIG, root, timeoutMs: 50 },
    });
    await Bun.sleep(700);

    expect(result.timedOut).toBe(true);
    expect(await fileExists(marker)).toBe(false);
  });

  test("jails cwd before container adapter and does not jail remote", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-root-"));
    const outside = await mkdtemp(join(tmpdir(), "zox-sub-outside-"));
    const argvSeen: string[][] = [];
    const containerDenied = await runSandboxed({
      argv: ["echo", "hello"],
      cwd: outside,
      config: { ...DEFAULT_SANDBOX_CONFIG, root, mode: "container" },
      spawn: ((cmd: string[]) => {
        argvSeen.push(cmd);
        return {
          pid: 1,
          exited: Promise.resolve(0),
          stdout: new Response("").body,
          stderr: new Response("").body,
          kill() {},
        };
      }) as never,
    });
    expect(containerDenied.denied).toBe(true);
    expect(containerDenied.denyReason).toMatch(/jail/i);
    expect(argvSeen).toEqual([]);

    const remote = await runSandboxed({
      argv: ["echo", "hello"],
      cwd: outside,
      config: { ...DEFAULT_SANDBOX_CONFIG, root, mode: "remote" },
      remoteExec: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "remote-ok",
        stderr: "",
        truncated: false,
        timedOut: false,
        denied: false,
        durationMs: 1,
      }),
    });
    expect(remote.denied).toBe(false);
    expect(remote.stdout).toBe("remote-ok");
  });

  test("container spawn includes allowlisted PATH when opts.env is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const previousPath = globalThis.process.env.PATH;
    globalThis.process.env.PATH = previousPath || "/usr/bin";
    const argvSeen: string[][] = [];
    try {
      await runSandboxed({
        argv: ["echo", "hello"],
        cwd: root,
        env: {},
        config: { ...DEFAULT_SANDBOX_CONFIG, root, mode: "container" },
        spawn: ((cmd: string[]) => {
          argvSeen.push(cmd);
          return {
            pid: 1,
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
            kill() {},
          };
        }) as never,
      });
    } finally {
      if (previousPath === undefined) {
        delete globalThis.process.env.PATH;
      } else {
        globalThis.process.env.PATH = previousPath;
      }
    }
    const joined = (argvSeen[0] ?? []).join(" ");
    expect(joined).toContain("-e PATH=");
  });

  test("remote without injected exec is denied", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sub-"));
    const result = await runSandboxed({
      argv: ["echo", "hello"],
      cwd: root,
      config: { ...DEFAULT_SANDBOX_CONFIG, root, mode: "remote" },
    });
    expect(result.denied).toBe(true);
    expect(result.denyReason).toBe("remote adapter not configured");
    expect(result.exitCode).toBe(-100);
  });
});

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
