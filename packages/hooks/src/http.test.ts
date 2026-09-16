import { afterEach, describe, expect, test } from "bun:test";
import { runHooks } from "./runner.ts";
import type { HookEntry, HookInput, HooksFile } from "./types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function input(overrides: Partial<HookInput> = {}): HookInput {
  return {
    event: "PreToolUse",
    session: { id: "sess_1", workspaceRoot: "/tmp/ws" },
    tool: { name: "bash", arguments: { command: "ls" } },
    ...overrides,
  };
}

function httpHooksFile(entry: Partial<HookEntry> = {}): HooksFile {
  return {
    zoxHooksVersion: 1,
    hooks: {
      PreToolUse: [
        {
          matcher: "bash",
          type: "http",
          url: "https://hooks.example/pre",
          ...entry,
        },
      ],
    },
  };
}

describe("http hooks", () => {
  test("PreToolUse http hook denies when fetch returns deny JSON", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ decision: "deny", reason: "nope" }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await runHooks({
      files: [httpHooksFile({ headers: { "X-Hook": "1" } })],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      trusted: true,
      cwd: process.cwd(),
    });

    expect(result).toEqual({ decision: "deny", reason: "nope" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://hooks.example/pre");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("content-type")).toMatch(/application\/json/i);
    expect(headers.get("X-Hook")).toBe("1");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      event: "PreToolUse",
      session: { id: "sess_1", workspaceRoot: "/tmp/ws" },
      tool: { name: "bash", arguments: { command: "ls" } },
    });
  });

  test("network error with onError warn allows and continues", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await runHooks({
      files: [httpHooksFile()],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      trusted: true,
      cwd: process.cwd(),
      onError: "warn",
    });

    expect(fetchCalled).toBe(true);
    expect(result.decision).toBe("allow");
  });
});
