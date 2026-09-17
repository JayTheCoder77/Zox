import { afterEach, describe, expect, test } from "bun:test";
import { SessionEventBus } from "./bus.ts";
import {
  type SessionWsData,
  sessionWebSocket,
  sessionWebSocketHandlers,
} from "./ws.ts";

const token = "ws-test-token";

function waitOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("ws error")), {
      once: true,
    });
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.addEventListener(
      "message",
      (event) => {
        resolve(String(event.data));
      },
      { once: true },
    );
    ws.addEventListener("error", () => reject(new Error("ws message error")), {
      once: true,
    });
  });
}

describe("sessionWebSocket", () => {
  const servers: Array<{ stop(close?: boolean): void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true);
  });

  test("rejects missing token with 401", async () => {
    const handle = sessionWebSocket({
      token,
      getSession: () => ({ id: "sess-1" }),
      bus: new SessionEventBus(),
      respondPermission: () => {},
    });
    const res = handle(
      new Request("http://127.0.0.1/sessions/sess-1/ws"),
      {} as Bun.Server<SessionWsData>,
    );
    expect(res?.status).toBe(401);
  });

  test("rejects unknown session with 404", async () => {
    const handle = sessionWebSocket({
      token,
      getSession: () => undefined,
      bus: new SessionEventBus(),
      respondPermission: () => {},
    });
    const res = handle(
      new Request("http://127.0.0.1/sessions/missing/ws?token=ws-test-token"),
      {} as Bun.Server<SessionWsData>,
    );
    expect(res?.status).toBe(404);
  });

  test("permission.response over websocket resolves the ask", async () => {
    const bus = new SessionEventBus();
    const calls: Array<{
      sessionId: string;
      requestId: string;
      approved: boolean;
    }> = [];
    const handle = sessionWebSocket({
      token,
      getSession: (id) => (id === "sess-1" ? { id } : undefined),
      bus,
      respondPermission(sessionId, requestId, approved) {
        calls.push({ sessionId, requestId, approved });
      },
    });

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req, bunServer) {
        const res = handle(req, bunServer);
        if (res === undefined) return;
        return res;
      },
      websocket: sessionWebSocketHandlers,
    });
    servers.push(server);

    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}/sessions/sess-1/ws?token=${token}`,
    );
    await waitOpen(ws);

    const got = nextMessage(ws);
    bus.publish("sess-1", {
      type: "tool.permission_required",
      sessionId: "sess-1",
      requestId: "req-1",
      toolCallId: "tc-1",
      name: "write",
    });
    const payload = JSON.parse(await got) as {
      type: string;
      requestId: string;
    };
    expect(payload.type).toBe("tool.permission_required");
    expect(payload.requestId).toBe("req-1");

    ws.send(
      JSON.stringify({
        type: "permission.response",
        requestId: "req-1",
        approved: true,
      }),
    );
    await Bun.sleep(20);
    expect(calls).toEqual([
      { sessionId: "sess-1", requestId: "req-1", approved: true },
    ]);

    ws.send(JSON.stringify({ type: "unknown.noise", extra: true }));
    await Bun.sleep(20);
    expect(calls).toHaveLength(1);
    ws.close();
  });

  test("accepts Authorization Bearer instead of query token", async () => {
    const bus = new SessionEventBus();
    const handle = sessionWebSocket({
      token,
      getSession: (id) => (id === "sess-1" ? { id } : undefined),
      bus,
      respondPermission: () => {},
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req, bunServer) {
        const res = handle(req, bunServer);
        if (res === undefined) return;
        return res;
      },
      websocket: sessionWebSocketHandlers,
    });
    servers.push(server);

    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}/sessions/sess-1/ws`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await waitOpen(ws);
    const got = nextMessage(ws);
    bus.publish("sess-1", {
      type: "session.status",
      sessionId: "sess-1",
      status: "idle",
    });
    const payload = JSON.parse(await got) as { type: string };
    expect(payload.type).toBe("session.status");
    ws.close();
  });
});
