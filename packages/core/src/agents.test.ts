import { describe, expect, test } from "bun:test";
import { getAgentProfile, toolMatchesProfile } from "./agents.ts";
import { evaluatePermission } from "./permissions.ts";

describe("getAgentProfile", () => {
  test("plan exposes read-only tools and denies mutation tools", () => {
    const plan = getAgentProfile("plan");

    expect(plan.tools).toEqual([
      "read",
      "grep",
      "glob",
      "ls",
      "skill",
      "todowrite",
      "memory_search",
      "memory_write",
      "code_search",
    ]);
    expect(evaluatePermission(plan.ruleset, "todowrite")).toBe("allow");
    expect(evaluatePermission(plan.ruleset, "memory_search")).toBe("allow");
    expect(evaluatePermission(plan.ruleset, "memory_write")).toBe("ask");
    expect(evaluatePermission(plan.ruleset, "code_search")).toBe("allow");
    expect(plan.tools).not.toContain("webfetch");
    expect(evaluatePermission(plan.ruleset, "write", "a.ts")).toBe("deny");
    expect(evaluatePermission(plan.ruleset, "read", "a.ts")).toBe("allow");
    expect(toolMatchesProfile(plan.tools, "mcp_github_list")).toBe(false);
    expect(evaluatePermission(plan.ruleset, "mcp_github_list")).toBe("deny");
    expect(toolMatchesProfile(plan.tools, "webfetch")).toBe(false);
    expect(plan.tools).not.toContain("task");
    expect(evaluatePermission(plan.ruleset, "task")).toBe("deny");
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
      "webfetch",
      "memory_search",
      "memory_write",
      "code_search",
      "task",
      "mcp_*",
    ]);
    expect(evaluatePermission(build.ruleset, "memory_search")).toBe("allow");
    expect(evaluatePermission(build.ruleset, "code_search")).toBe("allow");
    expect(evaluatePermission(build.ruleset, "memory_write")).toBe("ask");
    expect(evaluatePermission(build.ruleset, "todowrite")).toBe("allow");
    expect(evaluatePermission(build.ruleset, "bash", "git status")).toBe("ask");
    expect(evaluatePermission(build.ruleset, "webfetch")).toBe("ask");
    expect(evaluatePermission(build.ruleset, "task")).toBe("ask");
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

  test("build overlay tells the agent to implement", () => {
    const overlay = getAgentProfile("build").systemOverlay;
    expect(overlay).toContain("implement");
    expect(overlay).toContain("write");
  });

  test("plan overlay tells the agent to investigate and use todowrite", () => {
    const overlay = getAgentProfile("plan").systemOverlay;
    expect(overlay).toContain("todowrite");
    expect(overlay).toContain("read-only");
    expect(overlay).not.toContain("implement in the workspace");
    expect(overlay).not.toContain("code_search");
  });

  test("build overlay does not stuff code index into the system prompt", () => {
    const overlay = getAgentProfile("build").systemOverlay;
    expect(overlay).not.toContain("code_search");
    expect(overlay).not.toContain("code_chunks");
  });
});
