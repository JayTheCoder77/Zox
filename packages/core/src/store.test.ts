import { describe, expect, test } from "bun:test";
import type { SessionStore, UsageRow } from "./store.ts";
import { MemorySessionStore } from "./store.ts";

function assertSessionStore(store: SessionStore): SessionStore {
  return store;
}

describe("MemorySessionStore", () => {
  test("creates an idle session", () => {
    const store = new MemorySessionStore();
    const session = store.create({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
    });
    expect(session.status).toBe("idle");
    expect(session.messages).toEqual([]);
    expect(session.sandboxRoot).toBe("/tmp/ws");
    expect(session.sandboxMode).toBe("worktree");
    expect(session.planJson).toBeNull();
    expect(session.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(store.get(session.id)?.id).toBe(session.id);
  });

  test("honors sandboxRoot on create", () => {
    const store = new MemorySessionStore();
    const session = store.create({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
      sandboxRoot: "/tmp/ws/.zox/worktrees/sess",
    });
    expect(session.sandboxRoot).toBe("/tmp/ws/.zox/worktrees/sess");
  });

  test("returns undefined for unknown ids", () => {
    const store = new MemorySessionStore();
    expect(store.get("missing")).toBeUndefined();
  });

  test("satisfies SessionStore save and usage", () => {
    const store = assertSessionStore(new MemorySessionStore());
    const created = store.create({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
    });
    created.messages.push({ id: "msg_1", role: "user", content: "hi" });
    created.usage = { inputTokens: 3, outputTokens: 1 };
    store.save(created);
    expect(store.get(created.id)?.messages).toEqual([
      { id: "msg_1", role: "user", content: "hi" },
    ]);

    const rec: UsageRow = {
      id: "use_1",
      sessionId: created.id,
      turnId: "turn_1",
      provider: "mock",
      model: "mock/echo",
      inputTokens: 3,
      outputTokens: 1,
      durationMs: 5,
    };
    store.addUsage(created.id, rec);
    expect(store.listUsage(created.id)).toEqual([rec]);
  });
});
