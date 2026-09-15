import { describe, expect, test } from "bun:test";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "@zox/server";
import { createZoxClient } from "./client.ts";

describe("createZoxClient", () => {
  test("receives mock message.delta over SSE", async () => {
    const token = "sdk-token";
    const hono = createApp({
      token,
      store: new MemorySessionStore(),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
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
    const hono = createApp({
      token,
      store: new MemorySessionStore(),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
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
});
