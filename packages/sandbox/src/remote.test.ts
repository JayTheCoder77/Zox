import { describe, expect, test } from "bun:test";
import { createRemoteAdapter } from "./remote.ts";

describe("createRemoteAdapter", () => {
  test("remote adapter delegates to injected exec and does not read host cwd", async () => {
    const adapter = createRemoteAdapter({
      exec: async () => ({
        ok: true,
        exitCode: 0,
        stdout: "remote",
        stderr: "",
        truncated: false,
        timedOut: false,
        denied: false,
        durationMs: 1,
      }),
    });
    const result = await adapter.exec({
      argv: ["echo"],
      cwd: "/should-not-matter",
      env: {},
      timeoutMs: 1,
      maxOutputBytes: 10,
    });
    expect(result.stdout).toBe("remote");
    expect(adapter.mode).toBe("remote");
  });
});
