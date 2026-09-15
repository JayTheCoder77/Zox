import { describe, expect, test } from "bun:test";
import { evaluatePermission } from "./permissions.ts";

describe("evaluatePermission", () => {
  test("deny list wins over allow", () => {
    expect(
      evaluatePermission(
        { bash: { default: "ask", allow: ["rm*"], deny: ["rm -rf /"] } },
        "bash",
        "rm -rf /",
      ),
    ).toBe("deny");
  });

  test("allow prefix git status*", () => {
    expect(
      evaluatePermission(
        { bash: { default: "ask", allow: ["git status*"] } },
        "bash",
        "git status --short",
      ),
    ).toBe("allow");
  });

  test("uses exact matches when an entry has no trailing star", () => {
    const ruleset = {
      bash: { default: "ask" as const, allow: ["git status"] },
    };

    expect(evaluatePermission(ruleset, "bash", "git status")).toBe("allow");
    expect(evaluatePermission(ruleset, "bash", "git status --short")).toBe(
      "ask",
    );
  });

  test("matches the tool name when command or path is omitted", () => {
    expect(evaluatePermission({ read: { allow: ["read"] } }, "read")).toBe(
      "allow",
    );
  });

  test("falls back to ask when no default is configured", () => {
    expect(evaluatePermission({ bash: {} }, "bash", "pwd")).toBe("ask");
  });

  test("denies an unknown tool name", () => {
    expect(evaluatePermission({}, "unknown")).toBe("deny");
  });
});
