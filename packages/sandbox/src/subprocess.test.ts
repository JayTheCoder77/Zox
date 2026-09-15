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
    const result = await runSandboxed({
      argv: [
        "bash",
        "-lc",
        "printf '1234567890123456'; printf 'abcdefghijklmnop' >&2; while :; do :; done",
      ],
      cwd: root,
      config: {
        ...DEFAULT_SANDBOX_CONFIG,
        root,
        maxOutputBytes: 20,
        timeoutMs: 500,
      },
      shell: true,
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
    const result = await runSandboxed({
      argv: ["bash", "-lc", "(sleep 0.4; touch escaped) & wait"],
      cwd: root,
      config: { ...DEFAULT_SANDBOX_CONFIG, root, timeoutMs: 50 },
      shell: true,
    });
    await Bun.sleep(700);

    expect(result.timedOut).toBe(true);
    expect(await fileExists(marker)).toBe(false);
  });
});

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
