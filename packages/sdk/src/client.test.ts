import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "../../server/src/app.ts";
import { createZoxClient } from "./client.ts";

function testApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const { config: overrideConfig, ...rest } = overrides;
  return createApp({
    token: "sdk-token",
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
    ...rest,
    config: {
      sandbox: { mode: "host" },
      ...overrideConfig,
    },
  });
}

describe("createZoxClient", () => {
  test("receives mock message.delta over SSE", async () => {
    const token = "sdk-token";
    const hono = testApp({ token });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      const deltas: string[] = [];
      for await (const event of session.send("ping").events()) {
        if (event.type === "message.delta") deltas.push(event.delta);
      }
      expect(deltas.join("")).toBe("ping");
    } finally {
      server.stop(true);
    }
  });

  test("waitForIdle drains until session.status idle", async () => {
    const token = "sdk-token";
    const hono = testApp({ token });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      await session.send("ping").waitForIdle();
      const usage = await session.getUsage();
      expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
    } finally {
      server.stop(true);
    }
  });

  test("collectText concatenates message.delta events", async () => {
    const token = "sdk-token";
    const hono = testApp({ token });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      const text = await session.send("ping").collectText();
      expect(text).toBe("ping");
    } finally {
      server.stop(true);
    }
  });

  test("onTool is extra and events() still delivers tool events", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sdk-ontool-"));
    const token = "sdk-token";
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
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({ workspaceRoot: root });
      const run = session.send("write it");
      const handled: string[] = [];
      run.onTool((event) => {
        handled.push(event.type);
      });
      const fromIterator: string[] = [];
      for await (const event of run.events()) {
        fromIterator.push(event.type);
        if (event.type === "tool.permission_required") {
          await run.respondPermission(event.requestId, { approved: true });
        }
      }
      expect(handled).toContain("tool.permission_required");
      expect(fromIterator).toContain("tool.permission_required");
      expect(fromIterator).toContain("tool.started");
    } finally {
      server.stop(true);
    }
  });

  test("onTool throw does not halt waitForIdle", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sdk-ontool-throw-"));
    const token = "sdk-token";
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
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({ workspaceRoot: root });
      const run = session.send("write it");
      run.onTool((event) => {
        if (event.type === "tool.permission_required") {
          void run.respondPermission(event.requestId, { approved: true });
        }
        throw new Error("subscriber exploded");
      });
      await run.waitForIdle();
    } finally {
      server.stop(true);
    }
  });

  test("second send() streams only the new turn deltas", async () => {
    const token = "sdk-token";
    const hono = testApp({ token });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      for await (const _ of session.send("ping").events()) {
        /* drain first turn */
      }
      const deltas: string[] = [];
      for await (const event of session.send("pong").events()) {
        if (event.type === "message.delta") deltas.push(event.delta);
      }
      expect(deltas.join("")).toBe("pong");
    } finally {
      server.stop(true);
    }
  });

  test("sessions.list and sessions.get then send", async () => {
    const token = "sdk-token";
    const hono = testApp({ token });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const created = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      for await (const _ of created.send("ping").events()) {
        /* drain */
      }
      const { sessions } = await client.sessions.list("/tmp/ws");
      expect(sessions.some((s) => s.id === created.id)).toBe(true);
      const resumed = await client.sessions.get(created.id);
      const deltas: string[] = [];
      for await (const event of resumed.send("pong").events()) {
        if (event.type === "message.delta") deltas.push(event.delta);
      }
      expect(deltas.join("")).toBe("pong");
    } finally {
      server.stop(true);
    }
  });

  test("getUsage, command usage, and close after a turn", async () => {
    const token = "sdk-token";
    const hono = testApp({ token });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      for await (const _ of session.send("ping").events()) {
        /* drain turn */
      }
      const usage = await session.getUsage();
      expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.outputTokens).toBeGreaterThanOrEqual(0);

      const cmdUsage = (await session.command("usage")) as {
        inputTokens: number;
        outputTokens: number;
      };
      expect(cmdUsage.inputTokens).toBeGreaterThanOrEqual(0);

      await session.close();
    } finally {
      server.stop(true);
    }
  });

  test("compact returns without error", async () => {
    const token = "sdk-token";
    const hono = testApp({
      token,
      summarize: async () => "SUM",
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      for await (const _ of session.send("first").events()) {
        /* drain */
      }
      for await (const _ of session.send("second").events()) {
        /* drain */
      }
      await session.compact();
    } finally {
      server.stop(true);
    }
  });

  test("models.list returns catalog", async () => {
    const token = "sdk-token";
    const hono = testApp({ token });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const { models } = await client.models.list();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  test("list → load → send includes skill prefix", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-sdk-skills-"));
    await Bun.write(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nALWAYS conventional commits.\n",
    );
    let sawPrefix = false;
    const hono = testApp({
      token: "sdk-token",
      router: createProviderRouter({
        adapters: [
          createMockAdapter({
            script: async function* (params) {
              sawPrefix = params.messages.some(
                (m) =>
                  m.role === "system" &&
                  String("content" in m ? m.content : "").includes(
                    "ALWAYS conventional commits",
                  ),
              );
              yield { type: "text-delta", text: "ok" };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
            },
          }),
        ],
      }),
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token: "sdk-token",
      });
      const catalog = await client.skills.list(root);
      expect(catalog.skills.some((s) => s.name === "helper")).toBe(true);
      const session = await client.sessions.create({ workspaceRoot: root });
      await session.skills.load("helper");
      expect(await session.skills.active()).toEqual(["helper"]);
      for await (const _ of session.send("hi").events()) {
        /* drain */
      }
      expect(sawPrefix).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
