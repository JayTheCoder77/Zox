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

function app(
  overrides: Parameters<typeof createApp>[0] extends infer T
    ? Partial<T>
    : never = {},
) {
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  const { config: overrideConfig, ...rest } = overrides;
  return createApp({
    token,
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
    tools,
    ...rest,
    config: {
      sandbox: { mode: "host" },
      ...overrideConfig,
    },
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
  return (await created.json()) as {
    id: string;
    status: string;
    model: string;
  };
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
      config: { sandbox: { mode: "host" } },
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

  test("/skill persists skill body and surfaces it on GET /memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skill-inject-"));
    const skillDir = join(root, ".zox/skills/helper");
    await Bun.write(
      join(skillDir, "SKILL.md"),
      "---\nname: helper\n---\nALWAYS use conventional commits.\n",
    );
    const server = app();
    const session = await createSession(server, root);
    const injected = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "skill", args: ["helper"] }),
    });
    expect(injected.status).toBe(200);
    const memory = await server.request(`/sessions/${session.id}/memory`, {
      headers: auth,
    });
    const json = (await memory.json()) as {
      activeSkills: Array<{ name: string; body: string }>;
    };
    expect(json.activeSkills).toHaveLength(1);
    expect(json.activeSkills[0]?.name).toBe("helper");
    expect(json.activeSkills[0]?.body).toContain(
      "ALWAYS use conventional commits",
    );
  });

  test("GET /skills lists workspace catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-http-"));
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nbody\n",
    );
    const server = app();
    const res = await server.request(
      `/skills?workspaceRoot=${encodeURIComponent(root)}`,
      { headers: auth },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { skills: Array<{ name: string }> };
    expect(json.skills.some((s) => s.name === "helper")).toBe(true);
  });

  test("POST load then GET session skills; unload via /skill -u", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-sess-"));
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nBODY\n",
    );
    const server = app();
    const session = await createSession(server, root);
    const loaded = await server.request(`/sessions/${session.id}/skills`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", name: "helper" }),
    });
    expect(loaded.status).toBe(200);
    const listed = await server.request(`/sessions/${session.id}/skills`, {
      headers: auth,
    });
    const json = (await listed.json()) as {
      active: Array<{ name: string }>;
    };
    expect(json.active.map((s) => s.name)).toEqual(["helper"]);
    const unloaded = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "skill", args: ["-u", "helper"] }),
    });
    expect(unloaded.status).toBe(200);
    const after = await server.request(`/sessions/${session.id}/skills`, {
      headers: auth,
    });
    const afterJson = (await after.json()) as { active: unknown[] };
    expect(afterJson.active).toEqual([]);
  });

  test("skill tool during a turn publishes skills.changed", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-tool-sse-"));
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nBODY\n",
    );
    let n = 0;
    const tools = new ToolRegistry();
    for (const tool of createBuiltinTools()) tools.register(tool);
    const server = createApp({
      token,
      store: new MemorySessionStore(),
      tools,
      config: { sandbox: { mode: "host" } },
      router: createProviderRouter({
        adapters: [
          createMockAdapter({
            script: async function* () {
              n += 1;
              if (n === 1) {
                yield {
                  type: "tool-call",
                  id: "tcs",
                  name: "skill",
                  arguments: { name: "helper" },
                };
                yield { type: "usage", inputTokens: 1, outputTokens: 1 };
                yield { type: "done" };
                return;
              }
              yield { type: "text-delta", text: "loaded" };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
            },
          }),
        ],
      }),
    });
    const session = await createSession(server, root);
    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    const send = server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "use helper" }),
    });
    const body = await eventsRes.text();
    await send;
    expect(body).toContain("skills.changed");
    expect(body).toContain("helper");
  });

  test("/skills with no args lists catalog loaded flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-slash-list-"));
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nBODY\n",
    );
    const server = app();
    const session = await createSession(server, root);
    const listed = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "skills", args: [] }),
    });
    expect(listed.status).toBe(200);
    const json = (await listed.json()) as {
      skills: Array<{ name: string; loaded: boolean }>;
    };
    const helper = json.skills.find((s) => s.name === "helper");
    expect(helper?.loaded).toBe(false);
    await server.request(`/sessions/${session.id}/skills`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", name: "helper" }),
    });
    const listedLoaded = await server.request(
      `/sessions/${session.id}/commands`,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "skills" }),
      },
    );
    const loadedJson = (await listedLoaded.json()) as {
      skills: Array<{ name: string; loaded: boolean }>;
    };
    expect(loadedJson.skills.find((s) => s.name === "helper")?.loaded).toBe(
      true,
    );
  });

  test("/skills reload refreshes an already-loaded skill body from disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-slash-reload-"));
    const skillPath = join(root, ".zox/skills/helper/SKILL.md");
    await Bun.write(
      skillPath,
      "---\nname: helper\ndescription: help\n---\nORIGINAL\n",
    );
    const server = app();
    const session = await createSession(server, root);
    const loaded = await server.request(`/sessions/${session.id}/skills`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", name: "helper" }),
    });
    expect(loaded.status).toBe(200);
    await Bun.write(
      skillPath,
      "---\nname: helper\ndescription: help\n---\nUPDATED FROM DISK\n",
    );
    const reloaded = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "skills", args: ["reload"] }),
    });
    expect(reloaded.status).toBe(200);
    const after = await server.request(`/sessions/${session.id}/skills`, {
      headers: auth,
    });
    const afterJson = (await after.json()) as {
      active: Array<{ name: string; body: string }>;
    };
    expect(afterJson.active[0]?.name).toBe("helper");
    expect(afterJson.active[0]?.body).toContain("UPDATED FROM DISK");
    expect(afterJson.active[0]?.body).not.toContain("ORIGINAL");
  });

  test("/skills unload empties that skill from GET session skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-slash-unload-"));
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nBODY\n",
    );
    const server = app();
    const session = await createSession(server, root);
    const loaded = await server.request(`/sessions/${session.id}/skills`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", name: "helper" }),
    });
    expect(loaded.status).toBe(200);
    const unloaded = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "skills", args: ["unload", "helper"] }),
    });
    expect(unloaded.status).toBe(200);
    const after = await server.request(`/sessions/${session.id}/skills`, {
      headers: auth,
    });
    const afterJson = (await after.json()) as { active: unknown[] };
    expect(afterJson.active).toEqual([]);
  });

  test("/clear empties session active skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-clear-"));
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nBODY\n",
    );
    const server = app();
    const session = await createSession(server, root);
    const loaded = await server.request(`/sessions/${session.id}/skills`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", name: "helper" }),
    });
    expect(loaded.status).toBe(200);
    const cleared = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "clear" }),
    });
    expect(cleared.status).toBe(200);
    const after = await server.request(`/sessions/${session.id}/skills`, {
      headers: auth,
    });
    const afterJson = (await after.json()) as { active: unknown[] };
    expect(afterJson.active).toEqual([]);
  });

  test("/skill uses skills.loadPaths", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-skills-lp-"));
    const extra = await mkdtemp(join(tmpdir(), "zox-skills-lp-extra-"));
    await Bun.write(
      join(extra, "from-path/SKILL.md"),
      "---\nname: from-path\ndescription: extra\n---\nbody\n",
    );
    const server = createApp({
      token,
      store: new MemorySessionStore(),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: {
        sandbox: { mode: "host" },
        skills: { loadPaths: [extra] },
      },
    });
    const session = await createSession(server, root);
    const injected = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "skill", args: ["from-path"] }),
    });
    expect(injected.status).toBe(200);
    const memory = await server.request(`/sessions/${session.id}/memory`, {
      headers: auth,
    });
    const json = (await memory.json()) as {
      activeSkills: Array<{ name: string }>;
    };
    expect(json.activeSkills[0]?.name).toBe("from-path");
  });

  test("DELETE /mcp/servers/:name unregisters namespaced tools", async () => {
    const tools = new ToolRegistry();
    for (const tool of createBuiltinTools()) tools.register(tool);
    const fixture = join(import.meta.dir, "../../mcp/src/fixtures/fake-mcp.ts");
    const { McpPool } = await import("@zox/mcp");
    const mcp = new McpPool();
    const server = createApp({
      token,
      store: new MemorySessionStore(),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      tools,
      mcp,
    });
    const added = await server.request("/mcp/servers", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "github",
        command: process.execPath,
        args: [fixture],
      }),
    });
    expect(added.status).toBe(201);
    expect(tools.get("mcp_github_create_issue")).toBeDefined();
    const removed = await server.request("/mcp/servers/github", {
      method: "DELETE",
      headers: auth,
    });
    expect(removed.status).toBe(200);
    expect(tools.get("mcp_github_create_issue")).toBeUndefined();
    await mcp.remove("github");
  });
});
