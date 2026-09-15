import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySessionStore } from "@zox/core";
import { createObservability } from "@zox/observability";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createBuiltinTools, ToolRegistry } from "@zox/tools";
import { createApp } from "./app.ts";

const token = "test-token";

function app(overrides: Parameters<typeof createApp>[0] extends infer T
  ? Partial<T>
  : never = {}) {
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  return createApp({
    token,
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
    tools,
    ...overrides,
  });
}

const auth = { Authorization: `Bearer ${token}` };

async function createSession(
  server: ReturnType<typeof createApp>,
  workspaceRoot = "/tmp/ws",
) {
  const created = await server.request("/sessions", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { id: string; status: string; model: string };
}

async function readSseUntil(
  res: Response,
  predicate: (body: string) => boolean,
): Promise<{ body: string; drain: () => Promise<string> }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("missing body");
  const decoder = new TextDecoder();
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.value) {
      body += decoder.decode(chunk.value, { stream: true });
    }
    if (predicate(body)) {
      return {
        body,
        async drain() {
          while (true) {
            const rest = await reader.read();
            if (rest.value) {
              body += decoder.decode(rest.value, { stream: true });
            }
            if (rest.done) return body;
          }
        },
      };
    }
    if (chunk.done) {
      return { body, drain: async () => body };
    }
  }
}

describe("createApp", () => {
  test("creates a session, streams mock deltas over SSE, then idles", async () => {
    const server = app();
    const created = await server.request("/sessions", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot: "/tmp/ws" }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as {
      id: string;
      status: string;
      model: string;
    };
    expect(session.status).toBe("idle");
    expect(session.model).toBe("mock/echo");

    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.headers.get("content-type") ?? "").toContain(
      "text/event-stream",
    );

    const send = server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });

    const body = await eventsRes.text();
    await send;
    expect(body).toContain("message.delta");
    expect(body).toContain("ping");
    expect(body).toContain("message.completed");

    const got = await server.request(`/sessions/${session.id}`, {
      headers: auth,
    });
    const json = (await got.json()) as { status: string };
    expect(json.status).toBe("idle");
  });

  test("second turn SSE replays only the current turn", async () => {
    const server = app();
    const created = await server.request("/sessions", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot: "/tmp/ws" }),
    });
    const session = (await created.json()) as { id: string };

    const events1Res = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    await server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });
    await events1Res.text();

    const events2Res = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    await server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "pong" }),
    });
    const body2 = await events2Res.text();
    const deltas: string[] = [];
    for (const line of body2.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6)) as {
        type: string;
        delta?: string;
      };
      if (event.type === "message.delta" && event.delta !== undefined) {
        deltas.push(event.delta);
      }
    }
    expect(deltas.join("")).toBe("pong");
  });

  test("rejects missing bearer token with 401", async () => {
    const server = app();
    const res = await server.request("/models");
    expect(res.status).toBe(401);
  });

  test("GET /metrics returns 404 when metrics disabled", async () => {
    const server = app({
      observability: createObservability({ enabled: false }),
      config: { observability: { metrics: false } },
    });
    const res = await server.request("/metrics", { headers: auth });
    expect(res.status).toBe(404);
  });

  test("GET /metrics returns 200 for in-process local client when enabled", async () => {
    const server = app({
      observability: createObservability({ enabled: true }),
      config: { observability: { metrics: true } },
    });
    const res = await server.request("/metrics", { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/plain");
  });

  test("GET /models returns 200", async () => {
    const server = app();
    const res = await server.request("/models", { headers: auth });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      adapters: string[];
      models: string[];
    };
    expect(json.adapters).toContain("mock");
    expect(json.models.some((id) => id.startsWith("mock/"))).toBe(true);
  });

  test("GET /config never leaks secrets", async () => {
    const server = app({
      config: {
        model: "mock/echo",
        agent: "build",
        providers: {
          openai: { apiKeyEnv: "OPENAI_API_KEY", apiKey: "sk-secret-value" },
        },
      },
    });
    const res = await server.request("/config", { headers: auth });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("sk-secret-value");
    expect(text).toContain("OPENAI_API_KEY");
    expect(text).not.toMatch(/"apiKey"\s*:/);
  });

  test("permission deny path with mock write tool", async () => {
    let n = 0;
    const tools = new ToolRegistry();
    for (const tool of createBuiltinTools()) tools.register(tool);
    const server = createApp({
      token,
      store: new MemorySessionStore(),
      tools,
      router: createProviderRouter({
        adapters: [
          createMockAdapter({
            script: async function* () {
              n += 1;
              if (n === 1) {
                yield {
                  type: "tool-call",
                  id: "tcw",
                  name: "write",
                  arguments: { path: "out.txt", content: "nope" },
                };
                yield { type: "usage", inputTokens: 1, outputTokens: 1 };
                yield { type: "done" };
                return;
              }
              yield { type: "text-delta", text: "denied write" };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
            },
          }),
        ],
      }),
    });
    const session = await createSession(server);
    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    const send = server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "write it" }),
    });

    const untilPerm = await readSseUntil(eventsRes, (body) =>
      body.includes("tool.permission_required"),
    );
    expect(untilPerm.body).toContain("tool.permission_required");
    const requestId = /"requestId":"([^"]+)"/.exec(untilPerm.body)?.[1];
    expect(requestId).toBeDefined();

    const deny = await server.request(
      `/sessions/${session.id}/permissions/${requestId}`,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ approved: false }),
      },
    );
    expect(deny.status).toBe(200);

    const body = await untilPerm.drain();
    await send;
    expect(body).toContain("tool.completed");
    expect(body).toContain('"ok":false');
    expect(body).toContain("idle");
  });

  test("GET /usage after a turn has tokens", async () => {
    const server = app();
    const session = await createSession(server);
    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    await server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });
    await eventsRes.text();

    const usageRes = await server.request(`/usage?sessionId=${session.id}`, {
      headers: auth,
    });
    expect(usageRes.status).toBe(200);
    const usage = (await usageRes.json()) as {
      inputTokens: number;
      outputTokens: number;
    };
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });

  test("compact returns 200", async () => {
    const server = app({
      summarize: async () => "SUM",
    });
    const session = await createSession(server);
    const events1 = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    await server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    await events1.text();
    const events2 = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    await server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "second" }),
    });
    await events2.text();

    const compact = await server.request(`/sessions/${session.id}/compact`, {
      method: "POST",
      headers: auth,
    });
    expect(compact.status).toBe(200);
  });

  test("close writes summary when mocked summarizer injected", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-close-"));
    let called = false;
    const server = app({
      summarize: async () => {
        called = true;
        return "CLOSE SUMMARY";
      },
      config: { memory: { autoSummarize: true } },
    });
    const session = await createSession(server, root);
    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    await server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "wrap up" }),
    });
    await eventsRes.text();

    const closed = await server.request(`/sessions/${session.id}/close`, {
      method: "POST",
      headers: auth,
    });
    expect(closed.status).toBe(200);
    expect(called).toBe(true);
    const autoDir = join(root, ".zox/memory/auto");
    const listing = await Array.fromAsync(new Bun.Glob("*.md").scan(autoDir));
    expect(listing.length).toBeGreaterThan(0);
  });
});
