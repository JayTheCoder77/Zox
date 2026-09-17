import { describe, expect, test } from "bun:test";
import { createStoredSession, type StoredSession } from "@zox/core";
import { exportSession } from "./export-session.ts";
import { redactSecrets } from "./redact.ts";

function fakeSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    ...createStoredSession({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
    }),
    id: "sess_export",
    usage: { inputTokens: 11, outputTokens: 22 },
    createdAt: 1_700_000_000_000,
    messages: [
      {
        id: "msg_1",
        role: "user",
        content: "Authorization: Bearer abc.def",
      },
    ],
    ...overrides,
  };
}

describe("redactSecrets", () => {
  test("redacts bearer and openai keys", () => {
    expect(redactSecrets("Authorization: Bearer abc.def")).toContain(
      "[redacted]",
    );
    expect(redactSecrets("OPENAI_API_KEY=sk-123456789")).toContain(
      "[redacted]",
    );
  });

  test("redacts sk-ant, AIza, apiKey JSON, and ZOXX_SERVER_TOKEN", () => {
    expect(redactSecrets("key sk-ant-secretvalue")).not.toContain(
      "sk-ant-secretvalue",
    );
    expect(redactSecrets("key sk-ant-secretvalue")).toContain("[redacted]");
    expect(redactSecrets("google AIzaSyAbcdef123")).not.toContain(
      "AIzaSyAbcdef123",
    );
    expect(redactSecrets('{"apiKey":"super-secret"}')).not.toContain(
      "super-secret",
    );
    expect(redactSecrets('{"apiKey":"super-secret"}')).toContain("[redacted]");
    expect(redactSecrets("ZOXX_SERVER_TOKEN=tok_live_abc")).not.toContain(
      "tok_live_abc",
    );
    expect(redactSecrets("ZOXX_SERVER_TOKEN=tok_live_abc")).toContain(
      "[redacted]",
    );
  });
});

describe("exportSession", () => {
  test("export omits memory by default", async () => {
    const json = await exportSession({
      session: fakeSession(),
      includeMemory: false,
      readMemory: async () => ["secret fact"],
    });
    expect(json.memory).toBeUndefined();
  });

  test("export is schema version 1 with full redacted bodies", async () => {
    const json = await exportSession({
      session: fakeSession({
        messages: [
          {
            id: "m1",
            role: "user",
            content: "use OPENAI_API_KEY=sk-123456789 please",
            name: "user",
          },
        ],
      }),
    });
    expect(json.version).toBe(1);
    expect(json.session).toEqual({
      id: "sess_export",
      agent: "build",
      model: "mock/echo",
      status: "idle",
      createdAt: 1_700_000_000_000,
    });
    expect(json.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
    expect(json.messages[0]?.role).toBe("user");
    expect(json.messages[0]?.name).toBe("user");
    expect(json.messages[0]?.content).toContain("[redacted]");
    expect(json.messages[0]?.content).not.toContain("sk-123456789");
  });

  test("includeMemory true redacts memory strings", async () => {
    const json = await exportSession({
      session: fakeSession(),
      includeMemory: true,
      readMemory: async () => ["fact Bearer abc.def"],
    });
    expect(json.memory).toHaveLength(1);
    expect(json.memory?.[0]).toContain("[redacted]");
    expect(json.memory?.[0]).not.toContain("abc.def");
  });
});
