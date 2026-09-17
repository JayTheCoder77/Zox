import { describe, expect, test } from "bun:test";
import { pruneToolBodies } from "./prune.ts";

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

describe("pruneToolBodies", () => {
  test("is a no-op when disabled", () => {
    const messages = [
      { role: "tool" as const, name: "bash", content: "x".repeat(100_000) },
    ];
    expect(pruneToolBodies(messages, { enabled: false, estimate })).toEqual(
      messages,
    );
  });

  test("does not prune when reclaimable tokens are below minReclaim", () => {
    const messages = [
      { role: "user" as const, content: "hi" },
      { role: "tool" as const, name: "bash", content: "short" },
    ];
    const out = pruneToolBodies(messages, {
      enabled: true,
      protectMinTokens: 1,
      minReclaim: 20_000,
      estimate,
    });
    expect(out[1]?.content).toBe("short");
  });

  test("clears old unprotected tool bodies and keeps recent + protected", () => {
    const old = "o".repeat(80_000); // 20k tokens
    const recent = "n".repeat(160_000); // 40k tokens
    const skill = "SKILL BODY ".repeat(5000);
    const messages = [
      { role: "tool" as const, name: "bash", content: old },
      { role: "tool" as const, name: "skill", content: skill },
      { role: "tool" as const, name: "grep", content: recent },
    ];
    const out = pruneToolBodies(messages, {
      enabled: true,
      protectMinTokens: 40_000,
      minReclaim: 20_000,
      estimate,
    });
    expect(out[0]?.content).toBe("[pruned]");
    expect(out[1]?.content).toBe(skill);
    expect(out[2]?.content).toBe(recent);
  });
});
