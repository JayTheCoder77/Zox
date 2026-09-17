import { describe, expect, test } from "bun:test";
import type { ToolContext } from "./types.ts";
import { webfetchTool } from "./webfetch.ts";

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sandboxRoot: "/tmp",
    maxToolOutputChars: 32_000,
    session: { id: "s", workspaceRoot: "/tmp", agent: "build" },
    ...overrides,
  };
}

describe("webfetch tool", () => {
  test("rejects http://127.0.0.1/x", async () => {
    let fetched = false;
    const result = await webfetchTool.execute(
      { url: "http://127.0.0.1/x" },
      ctx({
        fetch: (async () => {
          fetched = true;
          return new Response("should not fetch");
        }) as unknown as typeof fetch,
      }),
    );
    expect(result.ok).toBe(false);
    expect(fetched).toBe(false);
  });

  test("rejects host not in allowlist", async () => {
    let fetched = false;
    const result = await webfetchTool.execute(
      { url: "https://evil.example/secret" },
      ctx({
        allowedHosts: ["example.com"],
        fetch: (async () => {
          fetched = true;
          return new Response("should not fetch");
        }) as unknown as typeof fetch,
      }),
    );
    expect(result.ok).toBe(false);
    expect(fetched).toBe(false);
  });

  test("truncates oversize body", async () => {
    const result = await webfetchTool.execute(
      { url: "https://example.com/big" },
      ctx({
        webfetchMaxBytes: 8,
        fetch: (async () =>
          new Response("abcdefghijklmnop", {
            status: 200,
            headers: { "content-type": "text/html" },
          })) as unknown as typeof fetch,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(8);
  });

  test("denies webfetch in container mode unless host is allowlisted", async () => {
    let fetched = false;
    const denied = await webfetchTool.execute(
      { url: "https://example.com/page" },
      ctx({
        session: {
          id: "s",
          workspaceRoot: "/tmp",
          agent: "build",
          sandboxMode: "container",
        },
        fetch: (async () => {
          fetched = true;
          return new Response("no");
        }) as unknown as typeof fetch,
      }),
    );
    expect(denied.ok).toBe(false);
    expect(denied.denied).toBe(true);
    expect(fetched).toBe(false);

    fetched = false;
    const allowed = await webfetchTool.execute(
      { url: "https://example.com/page" },
      ctx({
        session: {
          id: "s",
          workspaceRoot: "/tmp",
          agent: "build",
          sandboxMode: "remote",
        },
        allowedHosts: ["example.com"],
        fetch: (async () => {
          fetched = true;
          return new Response("ok");
        }) as unknown as typeof fetch,
      }),
    );
    expect(allowed.ok).toBe(true);
    expect(fetched).toBe(true);
  });

  test("stubs fetch for a 200 text/html response", async () => {
    const result = await webfetchTool.execute(
      { url: "https://example.com/page" },
      ctx({
        fetch: (async () =>
          new Response("<html>hello</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          })) as unknown as typeof fetch,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("hello");
  });
});
