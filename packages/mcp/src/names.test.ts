import { describe, expect, test } from "bun:test";
import { mcpToolName } from "./names.ts";

describe("mcpToolName", () => {
  test("namespaces server and tool as mcp_server_tool", () => {
    expect(mcpToolName("github", "create_issue")).toBe(
      "mcp_github_create_issue",
    );
  });
});
