import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { SqliteSessionStore } from "@zox/session";
import { createApp } from "../../server/src/app.ts";
import { createZoxClient } from "./client.ts";

function testApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const { config: overrideConfig, ...rest } = overrides;
  return createApp({
    token: "sdk-e2e-token",
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
    ...rest,
    config: {
      sandbox: { mode: "host" },
      ...overrideConfig,
    },
  });
}

function serve(hono: ReturnType<typeof createApp>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: hono.fetch,
  });
}

describe("sdk e2e", () => {
  test("approves a tool via respondPermission", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sdk-e2e-perm-"));
    const token = "sdk-e2e-token";
    const hono = testApp({
      token,
      router: createProviderRouter({
        adapters: [
          createMockAdapter({
            script: async function* () {
              yield {
                type: "tool-call",
                id: "tcw",
                name: "write",
                arguments: { path: "out.txt", content: "ok" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
            },
          }),
        ],
      }),
    });
    const server = serve(hono);
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({ workspaceRoot: root });
      const run = session.send("write it");
      const types: string[] = [];
      for await (const event of run.events()) {
        types.push(event.type);
        if (event.type === "tool.permission_required") {
          await run.respondPermission(event.requestId, { approved: true });
        }
      }
      expect(types).toContain("tool.permission_required");
      expect(types).toContain("tool.completed");
      expect(types.at(-1)).toBe("session.status");
    } finally {
      server.stop(true);
    }
  });

  test("list then get then send", async () => {
    const token = "sdk-e2e-token";
    const hono = testApp({ token });
    const server = serve(hono);
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const created = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      await created.send("ping").waitForIdle();
      const { sessions } = await client.sessions.list("/tmp/ws");
      expect(sessions.some((s) => s.id === created.id)).toBe(true);
      const resumed = await client.sessions.get(created.id);
      const text = await resumed.send("pong").collectText();
      expect(text).toBe("pong");
    } finally {
      server.stop(true);
    }
  });

  test("remember then search finds the pinned fact", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sdk-e2e-mem-"));
    const token = "sdk-e2e-token";
    const hono = testApp({
      token,
      store: new SqliteSessionStore({
        workspaceRoot: root,
        path: join(root, ".zox/state.sqlite"),
      }),
    });
    const server = serve(hono);
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({ workspaceRoot: root });
      const remembered = (await session.command("remember", [
        "ship",
        "alpha",
        "tomorrow",
      ])) as { ok?: boolean };
      expect(remembered.ok).toBe(true);
      const search = await fetch(
        `http://127.0.0.1:${server.port}/memory/search?q=tomorrow&workspaceRoot=${encodeURIComponent(root)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(search.status).toBe(200);
      const json = (await search.json()) as {
        memories: Array<{ content: string; pinned: boolean }>;
      };
      expect(json.memories[0]?.pinned).toBe(true);
      expect(json.memories[0]?.content).toContain("ship alpha tomorrow");
    } finally {
      server.stop(true);
    }
  });

  test("overflow auto-compact smoke with tiny windowTokens", async () => {
    const token = "sdk-e2e-token";
    const store = new MemorySessionStore();
    const hono = testApp({
      token,
      store,
      summarize: async () => "COMPACT-SUMMARY-UNIQUE",
      config: {
        context: { windowTokens: 100, overflowThreshold: 0.85 },
      },
    });
    const server = serve(hono);
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
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

      const run = session.send("keep this last user");
      const types: string[] = [];
      for await (const event of run.events()) {
        types.push(event.type);
      }
      expect(types).toContain("context.overflow");
      expect(types).toContain("context.compacted");
      await run.waitForIdle();
    } finally {
      server.stop(true);
    }
  });
});
