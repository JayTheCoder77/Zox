import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ToolContext } from "@zox/tools";
import { McpPool } from "./pool.ts";

const fixture = join(import.meta.dir, "fixtures/fake-mcp.ts");

const ctx: ToolContext = {
  sandboxRoot: "/tmp",
  maxToolOutputChars: 32_000,
  session: { id: "s1", workspaceRoot: "/tmp", agent: "build" },
};

let pool: McpPool | undefined;

afterEach(async () => {
  if (pool) {
    await pool.remove("github");
    pool = undefined;
  }
});

describe("McpPool", () => {
  test("adds a stdio server, lists namespaced tools, and executes tools/call", async () => {
    pool = new McpPool();
    await pool.add("github", {
      command: process.execPath,
      args: [fixture],
    });

    const listed = pool.list();
    expect(listed).toEqual([
      { name: "github", tools: ["mcp_github_create_issue"] },
    ]);

    const tools = pool.asZoxTools();
    const create = tools.find((t) => t.name === "mcp_github_create_issue");
    expect(create).toBeDefined();
    if (!create) {
      throw new Error("expected create_issue tool");
    }
    const result = await create.execute({ title: "bug" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("created issue: bug");
  });
});
