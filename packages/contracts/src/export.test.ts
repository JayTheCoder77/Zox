import { describe, expect, test } from "bun:test";
import { sessionExportSchema } from "./export.ts";

describe("sessionExportSchema", () => {
  test("accepts version 1 without memory", () => {
    const parsed = sessionExportSchema.parse({
      version: 1,
      session: {
        id: "sess_1",
        agent: "build",
        model: "mock/echo",
        status: "idle",
        createdAt: 1,
      },
      messages: [{ role: "user", content: "hi" }],
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    expect(parsed.version).toBe(1);
    expect(parsed.memory).toBeUndefined();
  });

  test("rejects other versions", () => {
    expect(() =>
      sessionExportSchema.parse({
        version: 2,
        session: {
          id: "sess_1",
          agent: "build",
          model: "mock/echo",
          status: "idle",
        },
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    ).toThrow();
  });
});
