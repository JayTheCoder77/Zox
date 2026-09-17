import { describe, expect, test } from "bun:test";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "../../server/src/app.ts";
import { sessionWebSocketHandlers } from "../../server/src/ws.ts";
import { createZoxClient } from "./client.ts";

const token = "sdk-ws-token";

function serveWs(app: ReturnType<typeof createApp>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === "GET" && /\/sessions\/[^/]+\/ws$/.test(url.pathname)) {
        const res = app.handleWebSocket(req, server);
        if (res === undefined) return;
        return res;
      }
      return app.fetch(req, server);
    },
    websocket: sessionWebSocketHandlers,
  });
}

describe("createZoxClient websocket", () => {
  test("defaults to SSE transport", () => {
    const client = createZoxClient({
      baseUrl: "http://127.0.0.1:1",
      token,
    });
    expect(typeof client.connectEvents).toBe("function");
  });

  test("connectEvents opens a session websocket", async () => {
    const app = createApp({
      token,
      store: new MemorySessionStore(),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: { sandbox: { mode: "host" } },
    });
    const server = serveWs(app);
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
        transport: "ws",
      });
      const session = await client.sessions.create({
        workspaceRoot: "/tmp/ws",
      });
      const ws = await client.connectEvents(session.id);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      server.stop(true);
    }
  });
});
