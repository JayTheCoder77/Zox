import { describe, expect, test } from "bun:test";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { runTurn } from "./loop.ts";
import type { StoredSession } from "./store.ts";

function session(): StoredSession {
  return {
    id: "sess_1",
    workspaceRoot: "/tmp/ws",
    agent: "build",
    model: "mock/echo",
    status: "idle",
    messages: [],
  };
}

describe("runTurn", () => {
  test("yields running, deltas, usage, completed, idle", async () => {
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    const events = [];
    for await (const event of runTurn({
      session: session(),
      userContent: "ping",
      router,
      ids: { messageId: () => "msg_asst", turnId: () => "turn_1" },
    })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "message.delta",
      "usage.turn",
      "message.completed",
      "session.status",
    ]);
    expect(events[1]).toMatchObject({
      type: "message.delta",
      delta: "ping",
      messageId: "msg_asst",
    });
    expect(events.at(-1)).toMatchObject({
      type: "session.status",
      status: "idle",
    });
  });
});
