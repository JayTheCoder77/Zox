import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySessionStore } from "@zox/core";
import { createHookRunner } from "@zox/hooks";
import { createObservability } from "@zox/observability";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { recordFileSnapshot, SqliteSessionStore } from "@zox/session";
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

  test("GET /sessions lists by workspaceRoot and resume attaches without autoLoad", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-session-resume-"));
    const dbPath = join(root, "state.sqlite");
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nhelper body\n",
    );
    await Bun.write(
      join(root, ".zox/skills/extra/SKILL.md"),
      "---\nname: extra\ndescription: extra\n---\nextra body\n",
    );
    const resumeMarker = join(root, "resume.ran");
    const resumeHook = join(root, "on-resume.sh");
    await Bun.write(
      resumeHook,
      `#!/bin/sh\ntouch "${resumeMarker}"\nprintf '%s\\n' '{"decision":"allow","message":"hello resume"}'\n`,
    );
    await chmod(resumeHook, 0o755);

    const first = createApp({
      token,
      store: new SqliteSessionStore({ path: dbPath }),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: {
        sandbox: { mode: "host" },
        skills: { autoLoad: ["helper"] },
      },
    });
    const session = await createSession(first, root);
    const eventsRes = await first.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    const send = first.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "remember this" }),
    });
    const streamed = await readSseUntil(eventsRes, (body) =>
      body.includes("message.completed"),
    );
    await send;
    await streamed.drain();

    const missing = await first.request("/sessions", { headers: auth });
    expect(missing.status).toBe(400);

    const resumed = createApp({
      token,
      store: new SqliteSessionStore({ path: dbPath }),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      hooks: createHookRunner({
        files: [
          {
            zoxHooksVersion: 1,
            hooks: {
              SessionStart: [
                { matcher: "resume", type: "command", command: resumeHook },
              ],
            },
          },
        ],
        trusted: true,
        cwd: root,
      }),
      config: {
        sandbox: { mode: "host" },
        skills: { autoLoad: ["helper", "extra"] },
      },
    });

    const got = await resumed.request(`/sessions/${session.id}`, {
      headers: auth,
    });
    expect(got.status).toBe(200);
    const loaded = (await got.json()) as {
      messages: Array<{ content: string }>;
    };
    expect(loaded.messages.some((m) => m.content === "remember this")).toBe(
      true,
    );

    const listed = await resumed.request(
      `/sessions?workspaceRoot=${encodeURIComponent(root)}&limit=50`,
      { headers: auth },
    );
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as {
      sessions: Array<{ id: string; createdAt: number }>;
    };
    expect(listJson.sessions.map((s) => s.id)).toContain(session.id);
    expect(typeof listJson.sessions[0]?.createdAt).toBe("number");

    const events2 = await resumed.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    const send2 = resumed.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "again" }),
    });
    const streamed2 = await readSseUntil(events2, (body) =>
      body.includes("message.completed"),
    );
    await send2;
    await streamed2.drain();

    expect(await Bun.file(resumeMarker).exists()).toBe(true);

    const skills = await resumed.request(`/sessions/${session.id}/skills`, {
      headers: auth,
    });
    const skillJson = (await skills.json()) as {
      active: Array<{ name: string }>;
    };
    expect(skillJson.active.map((s) => s.name)).toEqual(["helper"]);
  });

  test("resume hook throw stays retryable on the next attach", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-resume-retry-"));
    const dbPath = join(root, "state.sqlite");
    const first = createApp({
      token,
      store: new SqliteSessionStore({ path: dbPath }),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: { sandbox: { mode: "host" } },
    });
    const session = await createSession(first, root);

    let resumeAttempts = 0;
    const resumed = createApp({
      token,
      store: new SqliteSessionStore({ path: dbPath }),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      hooks: {
        async run(event) {
          if (event !== "SessionStart") return { decision: "allow" as const };
          resumeAttempts += 1;
          if (resumeAttempts === 1) throw new Error("resume hook failed");
          return { decision: "allow" as const };
        },
      },
      config: { sandbox: { mode: "host" } },
    });

    const failed = await resumed.request(`/sessions/${session.id}`, {
      headers: auth,
    });
    expect(failed.status).toBe(400);
    expect(resumeAttempts).toBe(1);

    const retried = await resumed.request(`/sessions/${session.id}`, {
      headers: auth,
    });
    expect(retried.status).toBe(200);
    expect(resumeAttempts).toBe(2);
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

  test("auto-compacts on hard overflow so the provider payload skips compacted range", async () => {
    const store = new MemorySessionStore();
    let firstPayload: Array<{ role: string; content?: string }> | undefined;
    const tools = new ToolRegistry();
    for (const tool of createBuiltinTools()) tools.register(tool);
    const server = createApp({
      token,
      store,
      tools,
      summarize: async () => "COMPACT-SUMMARY-UNIQUE",
      router: createProviderRouter({
        adapters: [
          createMockAdapter({
            script: async function* (params) {
              if (!firstPayload) {
                firstPayload = params.messages.map((message) => ({
                  role: message.role,
                  content: "content" in message ? String(message.content) : "",
                }));
              }
              yield { type: "text-delta", text: "ok" };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
            },
          }),
        ],
      }),
      config: {
        sandbox: { mode: "host" },
        context: { windowTokens: 100, overflowThreshold: 0.85 },
      },
    });
    const session = await createSession(server);
    const stored = store.get(session.id);
    expect(stored).toBeDefined();
    stored!.messages = [
      {
        id: "old_u",
        role: "user",
        content: `SKIPPED-RANGE-UNIQUE ${"x".repeat(400)}`,
      },
      {
        id: "old_a",
        role: "assistant",
        content: `SKIPPED-ASSISTANT-UNIQUE ${"y".repeat(400)}`,
      },
    ];
    store.save(stored!);

    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    const send = server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "keep this last user" }),
    });
    const body = await eventsRes.text();
    await send;

    expect(body).toContain("context.overflow");
    expect(body).toContain("context.compacted");
    expect(body).toContain("message.completed");
    expect(firstPayload).toBeDefined();
    const joined = firstPayload!
      .map((message) => message.content ?? "")
      .join("\n");
    expect(joined).toContain("COMPACT-SUMMARY-UNIQUE");
    expect(joined).not.toContain("SKIPPED-RANGE-UNIQUE");
    expect(joined).not.toContain("SKIPPED-ASSISTANT-UNIQUE");
    expect(joined).toContain("keep this last user");
    const after = store.get(session.id);
    expect(
      after?.messages.some((message) =>
        message.content.includes("SKIPPED-RANGE-UNIQUE"),
      ),
    ).toBe(true);
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

  test("close with rollingSummary writes rolling-summary.md and includes session context in prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-close-roll-"));
    const store = new MemorySessionStore();
    let capturedPrompt = "";
    const server = app({
      store,
      summarize: async (prompt) => {
        capturedPrompt = prompt;
        return "- Rolling bullet from close\n- Files: app.ts";
      },
      config: { memory: { autoSummarize: true, rollingSummary: true } },
    });
    const session = await createSession(server, root);
    const stored = store.get(session.id);
    expect(stored).toBeDefined();
    stored!.planJson = [
      { id: "1", content: "close-plan-goal", status: "in_progress" },
    ];
    stored!.priorStateMarkdown =
      "## Prior state (auto)\n- Goal: close-prior-goal";
    stored!.compactions = [
      {
        fromMessageId: "m1",
        toMessageId: "m2",
        summary: "CLOSE-COMPACT-SUMMARY",
      },
    ];
    store.save(stored!);

    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    await server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "wrap rolling" }),
    });
    await eventsRes.text();

    const closed = await server.request(`/sessions/${session.id}/close`, {
      method: "POST",
      headers: auth,
    });
    expect(closed.status).toBe(200);
    expect(capturedPrompt).toContain("close-plan-goal");
    expect(capturedPrompt).toContain("## Prior state");
    expect(capturedPrompt).toContain("CLOSE-COMPACT-SUMMARY");
    expect(capturedPrompt).toContain("wrap rolling");

    const rolling = await Bun.file(
      join(root, ".zox/memory/rolling-summary.md"),
    ).text();
    expect(rolling).toContain("Rolling bullet from close");
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

  test("POST /sessions/:id/hooks/test runs runner and 404s unknown session", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ decision: "deny", reason: "nope" }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const server = app({
        hooks: createHookRunner({
          files: [
            {
              zoxHooksVersion: 1,
              hooks: {
                PreToolUse: [
                  {
                    matcher: "*",
                    type: "http",
                    url: "https://hooks.example/pre",
                  },
                ],
              },
            },
          ],
          trusted: true,
          cwd: process.cwd(),
        }),
      });
      const session = await createSession(server);
      const tested = await server.request(
        `/sessions/${session.id}/hooks/test`,
        {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "PreToolUse",
            payload: {
              tool: { name: "bash", arguments: { command: "ls" } },
              session: { id: session.id, workspaceRoot: "/tmp/ws" },
            },
          }),
        },
      );
      expect(tested.status).toBe(200);
      expect(await tested.json()).toEqual({
        decision: "deny",
        reason: "nope",
      });

      const missing = await server.request(
        "/sessions/sess_missing/hooks/test",
        {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ event: "PreToolUse", payload: {} }),
        },
      );
      expect(missing.status).toBe(404);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("POST /sessions/:id/memory then GET /memory/search ranks pins first", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-mem-http-"));
    const server = createApp({
      token,
      store: new SqliteSessionStore({
        workspaceRoot: root,
        path: join(root, ".zox/state.sqlite"),
      }),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: { sandbox: { mode: "host" } },
    });
    const session = await createSession(server, root);

    const unpinned = await server.request(`/sessions/${session.id}/memory`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "alpha unpinned http fact" }),
    });
    expect(unpinned.status).toBe(201);

    const pinned = await server.request(`/sessions/${session.id}/memory`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "alpha pinned http fact", pinned: true }),
    });
    expect(pinned.status).toBe(201);

    const search = await server.request(
      `/memory/search?q=alpha&workspaceRoot=${encodeURIComponent(root)}`,
      { headers: auth },
    );
    expect(search.status).toBe(200);
    const json = (await search.json()) as {
      memories: Array<{ content: string; pinned: boolean }>;
    };
    expect(json.memories[0]?.pinned).toBe(true);
    expect(json.memories.map((m) => m.content)).toEqual([
      "alpha pinned http fact",
      "alpha unpinned http fact",
    ]);

    const snapshot = await server.request(`/sessions/${session.id}/memory`, {
      headers: auth,
    });
    const mem = (await snapshot.json()) as { injectedDurableIds: string[] };
    expect(Array.isArray(mem.injectedDurableIds)).toBe(true);
  });

  test("slash remember via /commands pins project fact", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-remember-"));
    const server = createApp({
      token,
      store: new SqliteSessionStore({
        workspaceRoot: root,
        path: join(root, ".zox/state.sqlite"),
      }),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: { sandbox: { mode: "host" } },
    });
    const session = await createSession(server, root);
    const help = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "help" }),
    });
    const helpJson = (await help.json()) as { commands: string[] };
    expect(helpJson.commands).toContain("remember");

    const remembered = await server.request(
      `/sessions/${session.id}/commands`,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "remember",
          args: ["ship", "alpha", "tomorrow"],
        }),
      },
    );
    expect(remembered.status).toBe(200);

    const search = await server.request(
      `/memory/search?q=tomorrow&workspaceRoot=${encodeURIComponent(root)}`,
      { headers: auth },
    );
    const json = (await search.json()) as {
      memories: Array<{ content: string; pinned: boolean }>;
    };
    expect(json.memories[0]?.pinned).toBe(true);
    expect(json.memories[0]?.content).toContain("ship alpha tomorrow");
  });

  test("GET /memory/search isolates memories by workspaceRoot", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "zox-mem-http-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "zox-mem-http-b-"));
    const server = createApp({
      token,
      store: new SqliteSessionStore({
        workspaceRoot: rootA,
        path: join(rootA, ".zox/state.sqlite"),
      }),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: { sandbox: { mode: "host" } },
    });
    const sessionA = await createSession(server, rootA);
    const sessionB = await createSession(server, rootB);

    const pinned = await server.request(`/sessions/${sessionA.id}/memory`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "sharedtoken http fact only in A",
        pinned: true,
      }),
    });
    expect(pinned.status).toBe(201);

    const searchB = await server.request(
      `/memory/search?q=sharedtoken&workspaceRoot=${encodeURIComponent(rootB)}`,
      { headers: auth },
    );
    expect(searchB.status).toBe(200);
    const jsonB = (await searchB.json()) as {
      memories: Array<{ content: string }>;
    };
    expect(jsonB.memories).toEqual([]);

    const searchA = await server.request(
      `/memory/search?q=sharedtoken&workspaceRoot=${encodeURIComponent(rootA)}`,
      { headers: auth },
    );
    expect(searchA.status).toBe(200);
    const jsonA = (await searchA.json()) as {
      memories: Array<{ content: string; pinned: boolean }>;
    };
    expect(jsonA.memories.map((m) => m.content)).toEqual([
      "sharedtoken http fact only in A",
    ]);
    expect(sessionB.id).not.toBe(sessionA.id);
  });

  test("POST /sessions/:id/revert restores a prepared snapshot row", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-revert-http-"));
    await Bun.write(join(root, "a.txt"), "old");
    const store = new SqliteSessionStore({
      workspaceRoot: root,
      path: join(root, ".zox/state.sqlite"),
    });
    const server = createApp({
      token,
      store,
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: { sandbox: { mode: "host" } },
    });
    const session = await createSession(server, root);
    const snap = await recordFileSnapshot({
      db: store.db,
      sessionId: session.id,
      sandboxRoot: root,
      relativePath: "a.txt",
    });
    if ("skipped" in snap) throw new Error("should record");
    await Bun.write(join(root, "a.txt"), "new");

    const missing = await server.request(`/sessions/${session.id}/revert`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ snapshotId: "snap_missing" }),
    });
    expect(missing.status).toBe(404);

    const restored = await server.request(`/sessions/${session.id}/revert`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ snapshotId: snap.id }),
    });
    expect(restored.status).toBe(200);
    const json = (await restored.json()) as {
      path: string;
      snapshotId: string;
    };
    expect(json.snapshotId).toBe(snap.id);
    expect(await Bun.file(join(root, "a.txt")).text()).toBe("old");

    await Bun.write(join(root, "a.txt"), "newer");
    const latest = await server.request(`/sessions/${session.id}/revert`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(latest.status).toBe(200);
    expect(await Bun.file(join(root, "a.txt")).text()).toBe("old");

    const viaCommand = await server.request(
      `/sessions/${session.id}/commands`,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "help" }),
      },
    );
    const helpJson = (await viaCommand.json()) as { commands: string[] };
    expect(helpJson.commands).toContain("revert");

    await Bun.write(join(root, "a.txt"), "from-command");
    const commandRevert = await server.request(
      `/sessions/${session.id}/commands`,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "revert", args: [snap.id] }),
      },
    );
    expect(commandRevert.status).toBe(200);
    expect(await Bun.file(join(root, "a.txt")).text()).toBe("old");
  });

  test("GET /sessions/:id/export redacts secrets and omits memory by default", async () => {
    const store = new MemorySessionStore();
    const server = app({ store });
    const session = await createSession(server);
    const stored = store.get(session.id);
    if (!stored) throw new Error("missing session");
    stored.messages.push({
      id: "msg_secret",
      role: "user",
      content:
        'OPENAI_API_KEY=sk-123456789 {"apiKey":"leak"} Bearer abc.def AIzaSyLeak sk-ant-leak ZOXX_SERVER_TOKEN=tok_live',
    });
    store.save(stored);

    const res = await server.request(`/sessions/${session.id}/export`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      version: number;
      memory?: string[];
      messages: Array<{ content: string }>;
    };
    expect(json.version).toBe(1);
    expect(json.memory).toBeUndefined();
    const blob = JSON.stringify(json);
    expect(blob).toContain("[redacted]");
    expect(blob).not.toContain("sk-123456789");
    expect(blob).not.toContain("sk-ant-leak");
    expect(blob).not.toContain("AIzaSyLeak");
    expect(blob).not.toContain("tok_live");
    expect(blob).not.toContain("abc.def");
    expect(blob).not.toContain('"leak"');
  });

  test("GET /sessions/:id/export?includeMemory=true includes redacted memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-export-mem-"));
    const store = new SqliteSessionStore({
      workspaceRoot: root,
      path: join(root, ".zox/state.sqlite"),
    });
    const server = createApp({
      token,
      store,
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: { sandbox: { mode: "host" } },
    });
    const session = await createSession(server, root);
    const written = await server.request(`/sessions/${session.id}/memory`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "remember OPENAI_API_KEY=sk-memsecret" }),
    });
    expect(written.status).toBe(201);

    const omitted = await server.request(`/sessions/${session.id}/export`, {
      headers: auth,
    });
    const omittedJson = (await omitted.json()) as { memory?: string[] };
    expect(omittedJson.memory).toBeUndefined();

    const included = await server.request(
      `/sessions/${session.id}/export?includeMemory=true`,
      { headers: auth },
    );
    expect(included.status).toBe(200);
    const json = (await included.json()) as { memory?: string[] };
    expect(json.memory?.some((m) => m.includes("[redacted]"))).toBe(true);
    expect(JSON.stringify(json)).not.toContain("sk-memsecret");
  });

  test("GET /sessions/:id/export returns 404 for unknown session", async () => {
    const server = app();
    const res = await server.request("/sessions/sess_missing/export", {
      headers: auth,
    });
    expect(res.status).toBe(404);
  });

  test("autoLoad failures surface once in systemNotes", async () => {
    let captured: Array<{ role: string; content: string }> = [];
    const tools = new ToolRegistry();
    for (const tool of createBuiltinTools()) tools.register(tool);
    const server = createApp({
      token,
      store: new MemorySessionStore(),
      tools,
      router: createProviderRouter({
        adapters: [
          createMockAdapter({
            async *script(params) {
              captured = params.messages;
              yield { type: "text-delta", text: "ok" };
              yield { type: "done" };
            },
          }),
        ],
      }),
      config: {
        sandbox: { mode: "host" },
        skills: { autoLoad: ["does-not-exist"] },
      },
    });
    const session = await createSession(server);
    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    const send = server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });
    const streamed = await readSseUntil(eventsRes, (body) =>
      body.includes("message.completed"),
    );
    await send;
    await streamed.drain();
    const notes = captured
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    expect(notes).toMatch(/does-not-exist/);
    expect(notes.toLowerCase()).toMatch(/skill/);
  });

  test("GET /hooks redacts http hooks to the url path", async () => {
    const server = app({
      config: {
        sandbox: { mode: "host" },
        hooks: {
          zoxHooksVersion: 1,
          hooks: {
            PreToolUse: [
              {
                matcher: "bash",
                type: "http",
                url: "https://hooks.example/zox?token=secret",
              },
            ],
          },
        },
      },
    });
    const res = await server.request("/hooks", { headers: auth });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      hooks: Record<string, Array<{ matcher: string; command: string }>>;
    };
    expect(json.hooks.PreToolUse?.[0]?.matcher).toBe("bash");
    expect(json.hooks.PreToolUse?.[0]?.command).toBe(
      "https://hooks.example/zox",
    );
    expect(JSON.stringify(json)).not.toContain("secret");
  });
});
