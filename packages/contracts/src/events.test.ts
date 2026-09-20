import { describe, expect, test } from "bun:test";
import { zoxEventSchema } from "./events.ts";

describe("zoxEventSchema", () => {
  test("parses message.delta", () => {
    const event = zoxEventSchema.parse({
      type: "message.delta",
      sessionId: "sess_1",
      messageId: "msg_1",
      delta: "Hello",
    });
    expect(event.type).toBe("message.delta");
    if (event.type === "message.delta") {
      expect(event.delta).toBe("Hello");
    }
  });

  test("parses session.status idle", () => {
    const event = zoxEventSchema.parse({
      type: "session.status",
      sessionId: "sess_1",
      status: "idle",
    });
    expect(event).toMatchObject({ status: "idle" });
  });

  test("rejects unknown event types", () => {
    const result = zoxEventSchema.safeParse({
      type: "not.a.real.event",
      sessionId: "sess_1",
    });
    expect(result.success).toBe(false);
  });

  test("parses budget.exceeded", () => {
    const event = zoxEventSchema.parse({
      type: "budget.exceeded",
      sessionId: "sess_1",
      reason: "max_turns",
    });
    expect(event).toMatchObject({
      type: "budget.exceeded",
      reason: "max_turns",
    });
  });

  test("parses skills.changed", () => {
    const event = zoxEventSchema.parse({
      type: "skills.changed",
      sessionId: "sess_1",
      active: ["helper"],
    });
    expect(event).toMatchObject({ type: "skills.changed", active: ["helper"] });
  });

  test("parses prompt.guardrail allow, deny, ask, and skipped", () => {
    expect(
      zoxEventSchema.parse({
        type: "prompt.guardrail",
        sessionId: "sess_1",
        outcome: "allow",
      }),
    ).toMatchObject({ type: "prompt.guardrail", outcome: "allow" });
    expect(
      zoxEventSchema.parse({
        type: "prompt.guardrail",
        sessionId: "sess_1",
        outcome: "deny",
        question: "injection",
        pYes: 0.92,
        confidence: 0.8,
      }),
    ).toMatchObject({
      type: "prompt.guardrail",
      outcome: "deny",
      question: "injection",
      pYes: 0.92,
      confidence: 0.8,
    });
    expect(
      zoxEventSchema.parse({
        type: "prompt.guardrail",
        sessionId: "sess_1",
        outcome: "skipped",
        reason: "missing_api_key",
      }),
    ).toMatchObject({ outcome: "skipped", reason: "missing_api_key" });
  });

  test("parses prompt.blocked and prompt.permission_required", () => {
    expect(
      zoxEventSchema.parse({
        type: "prompt.blocked",
        sessionId: "sess_1",
        question: "policy_violation",
        reason: "Prompt violates configured policy",
        pYes: 0.9,
        confidence: 0.81,
      }),
    ).toMatchObject({
      type: "prompt.blocked",
      question: "policy_violation",
    });
    expect(
      zoxEventSchema.parse({
        type: "prompt.permission_required",
        sessionId: "sess_1",
        requestId: "req_1",
        question: "injection",
        reason: "Possible prompt injection",
      }),
    ).toMatchObject({
      type: "prompt.permission_required",
      requestId: "req_1",
      question: "injection",
    });
  });
});
