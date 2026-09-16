import { describe, expect, test } from "bun:test";
import {
  createSessionRequestSchema,
  createSessionResponseSchema,
  sessionListResponseSchema,
} from "./session.ts";

describe("session DTOs", () => {
  test("create request defaults agent to build", () => {
    const parsed = createSessionRequestSchema.parse({
      workspaceRoot: "/tmp/ws",
    });
    expect(parsed.agent).toBe("build");
    expect(parsed.model).toBe("mock/echo");
  });

  test("session list response requires createdAt number", () => {
    const parsed = sessionListResponseSchema.parse({
      sessions: [
        {
          id: "sess_1",
          workspaceRoot: "/tmp/ws",
          agent: "build",
          model: "mock/echo",
          status: "idle",
          createdAt: 123,
        },
      ],
    });
    expect(parsed.sessions[0]?.createdAt).toBe(123);
  });

  test("create response requires id and idle status", () => {
    const parsed = createSessionResponseSchema.parse({
      id: "sess_1",
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
      status: "idle",
    });
    expect(parsed.id).toBe("sess_1");
  });
});
