import { describe, expect, test } from "bun:test";
import { ToolRegistry } from "./registry.ts";
import type { ZoxTool } from "./types.ts";

const stub: ZoxTool = {
  name: "mcp_github_create_issue",
  description: "stub",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { ok: true, content: "ok", truncated: false };
  },
};

describe("ToolRegistry", () => {
  test("unregister removes a previously registered tool", () => {
    const tools = new ToolRegistry();
    tools.register(stub);
    expect(tools.get("mcp_github_create_issue")).toBe(stub);
    tools.unregister("mcp_github_create_issue");
    expect(tools.get("mcp_github_create_issue")).toBeUndefined();
  });
});
