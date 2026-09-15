import { describe, expect, test } from "bun:test";
import { getAgentProfile } from "./agents.ts";
import { evaluatePermission } from "./permissions.ts";

describe("getAgentProfile", () => {
  test("plan exposes read-only tools and denies mutation tools", () => {
    const plan = getAgentProfile("plan");

    expect(plan.tools).toEqual(["read", "grep", "glob", "ls", "skill"]);
    expect(evaluatePermission(plan.ruleset, "write", "a.ts")).toBe("deny");
    expect(evaluatePermission(plan.ruleset, "read", "a.ts")).toBe("allow");
  });

  test("build exposes all specified tools with safe defaults", () => {
    const build = getAgentProfile("build");

    expect(build.tools).toEqual([
      "read",
      "grep",
      "glob",
      "ls",
      "skill",
      "todowrite",
      "write",
      "edit",
      "bash",
    ]);
    expect(evaluatePermission(build.ruleset, "todowrite")).toBe("allow");
    expect(evaluatePermission(build.ruleset, "bash", "git status")).toBe("ask");
  });

  test("denies unknown profile names", () => {
    expect(() => getAgentProfile("unknown")).toThrow(
      "Unknown agent profile: unknown",
    );
  });
});
