import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { createContainerAdapter } from "./container.ts";

function fakeExited(exitCode: number, stdout: string, stderr: string) {
  return {
    pid: 1,
    exited: Promise.resolve(exitCode),
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    kill() {},
  };
}

describe("createContainerAdapter", () => {
  test("container adapter uses docker run with workspace mount and no network", async () => {
    const argvSeen: string[][] = [];
    const adapter = createContainerAdapter({
      spawn: ((cmd: string[]) => {
        argvSeen.push(cmd);
        return fakeExited(0, "ok", "");
      }) as never,
    });
    await adapter.exec({
      argv: ["bun", "test"],
      cwd: "/ws",
      env: { SECRET: "x", PATH: "/bin" },
      timeoutMs: 1000,
      maxOutputBytes: 1000,
    });
    const dockerArgv = argvSeen[0] ?? [];
    expect(dockerArgv[0]).toBe("docker");
    expect(dockerArgv.join(" ")).toContain("--network none");
    expect(dockerArgv.join(" ")).toContain("/workspace");
  });

  test("strips env to default allowlist and never mounts host HOME", async () => {
    const argvSeen: string[][] = [];
    const adapter = createContainerAdapter({
      spawn: ((cmd: string[]) => {
        argvSeen.push(cmd);
        return fakeExited(0, "ok", "");
      }) as never,
    });
    await adapter.exec({
      argv: ["true"],
      cwd: "/ws",
      env: { SECRET: "x", PATH: "/bin", HOME: "/tmp/jail-home" },
      timeoutMs: 1000,
      maxOutputBytes: 1000,
    });
    const joined = (argvSeen[0] ?? []).join(" ");
    expect(joined).toContain("-e PATH=/bin");
    expect(joined).not.toContain("SECRET");
    expect(joined).not.toContain(`-v ${homedir()}`);
    expect(adapter.mode).toBe("container");
  });

  test("omits --network none when allowHosts is non-empty", async () => {
    const argvSeen: string[][] = [];
    const adapter = createContainerAdapter({
      allowHosts: ["example.com"],
      spawn: ((cmd: string[]) => {
        argvSeen.push(cmd);
        return fakeExited(0, "ok", "");
      }) as never,
    });
    await adapter.exec({
      argv: ["true"],
      cwd: "/ws",
      env: { PATH: "/bin" },
      timeoutMs: 1000,
      maxOutputBytes: 1000,
    });
    expect((argvSeen[0] ?? []).join(" ")).not.toContain("--network none");
  });

  test("returns docker unavailable when docker is missing", async () => {
    const adapter = createContainerAdapter({
      spawn: ((_cmd: string[]) => {
        const error = new Error("not found") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }) as never,
    });
    const result = await adapter.exec({
      argv: ["true"],
      cwd: "/ws",
      env: {},
      timeoutMs: 1000,
      maxOutputBytes: 1000,
    });
    expect(result.denied).toBe(true);
    expect(result.denyReason).toBe("docker unavailable");
    expect(result.exitCode).toBe(-100);
  });
});
