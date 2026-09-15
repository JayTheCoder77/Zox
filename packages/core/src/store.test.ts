import { describe, expect, test } from "bun:test";
import { MemorySessionStore } from "./store.ts";

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
    expect(store.get(session.id)?.id).toBe(session.id);
  });

  test("returns undefined for unknown ids", () => {
    const store = new MemorySessionStore();
    expect(store.get("missing")).toBeUndefined();
  });
});
