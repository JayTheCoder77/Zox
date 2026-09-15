import { describe, expect, test } from "bun:test";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "./app.ts";

const token = "test-token";

function app() {
  return createApp({
    token,
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
  });
}

const auth = { Authorization: `Bearer ${token}` };

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
});
