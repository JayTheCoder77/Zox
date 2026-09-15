import { describe, expect, test } from "bun:test";
import { getAgentProfile, toolMatchesProfile } from "./agents.ts";
import { evaluatePermission } from "./permissions.ts";

describe("getAgentProfile", () => {
  test("plan exposes read-only tools and denies mutation tools", () => {
    const plan = getAgentProfile("plan");

    expect(plan.tools).toEqual(["read", "grep", "glob", "ls", "skill"]);
    expect(evaluatePermission(plan.ruleset, "write", "a.ts")).toBe("deny");
    expect(evaluatePermission(plan.ruleset, "read", "a.ts")).toBe("allow");
    expect(toolMatchesProfile(plan.tools, "mcp_github_list")).toBe(false);
    expect(evaluatePermission(plan.ruleset, "mcp_github_list")).toBe("deny");
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
      "mcp_*",
    ]);
    expect(evaluatePermission(build.ruleset, "todowrite")).toBe("allow");
    expect(evaluatePermission(build.ruleset, "bash", "git status")).toBe("ask");
    expect(toolMatchesProfile(build.tools, "mcp_github_list")).toBe(true);
    expect(evaluatePermission(build.ruleset, "mcp_github_list")).toBe("allow");
    expect(evaluatePermission(build.ruleset, "mcp_github_create_issue")).toBe(
      "ask",
    );
    expect(evaluatePermission(build.ruleset, "mcp_fs_write")).toBe("ask");
    expect(evaluatePermission(build.ruleset, "mcp_db_delete_row")).toBe("ask");
    expect(evaluatePermission(build.ruleset, "mcp_docs_update")).toBe("ask");
  });

  test("denies unknown profile names", () => {
    expect(() => getAgentProfile("unknown")).toThrow(
      "Unknown agent profile: unknown",
    );
  });
});
