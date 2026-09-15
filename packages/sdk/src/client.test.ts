import { describe, expect, test } from "bun:test";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "@zox/server";
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
});
