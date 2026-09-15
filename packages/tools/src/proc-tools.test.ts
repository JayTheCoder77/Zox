import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuiltinTools } from "./builtins.ts";
import { ToolRegistry } from "./registry.ts";
import type { ToolContext, ZoxTool } from "./types.ts";

function registryWithBuiltins(): ToolRegistry {
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  return tools;
}

function ctx(root: string, maxToolOutputChars = 32_000): ToolContext {
  return {
    sandboxRoot: root,
    maxToolOutputChars,
    session: { id: "s", workspaceRoot: root, agent: "build" },
  };
}

function requiredTool(tools: ToolRegistry, name: string): ZoxTool {
  const tool = tools.get(name);
  expect(tool).toBeDefined();
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe("subprocess tools", () => {
  test("bash echo works and rm is denied", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-bash-"));
    const tools = registryWithBuiltins();

    const ok = await requiredTool(tools, "bash").execute(
      { command: "echo hi" },
      ctx(root),
    );
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain("hi");

    const denied = await requiredTool(tools, "bash").execute(
      { command: "rm -rf ." },
      ctx(root),
    );
    expect(denied.denied).toBe(true);
  });

  test("glob and ls see written files; grep finds a line", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-glob-"));
    await mkdir(join(root, "src"), { recursive: true });
    await Bun.write(join(root, "src/app.ts"), "export const n = 1;\n");
    const tools = registryWithBuiltins();

    const globbed = await requiredTool(tools, "glob").execute(
      { pattern: "**/*.ts" },
      ctx(root),
    );
    expect(globbed.content).toContain("src/app.ts");

    const listed = await requiredTool(tools, "ls").execute(
      { path: "src" },
      ctx(root),
    );
    expect(listed.content).toContain("app.ts");

    const hits = await requiredTool(tools, "grep").execute(
      { pattern: "export const", path: "src" },
      ctx(root),
    );
    expect(hits.content).toContain("app.ts");
  });

  test("all subprocess tool results respect the observation cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-caps-"));
    await Bun.write(join(root, "long.txt"), `${"x".repeat(40)}\n`);
    const tools = registryWithBuiltins();
    const context = ctx(root, 8);

    const results = await Promise.all([
      requiredTool(tools, "bash").execute(
        { command: "printf 123456789" },
        context,
      ),
      requiredTool(tools, "grep").execute({ pattern: "x" }, context),
      requiredTool(tools, "glob").execute({ pattern: "**/*" }, context),
      requiredTool(tools, "ls").execute({}, context),
    ]);

    for (const result of results) {
      expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(8);
    }
    expect(results[0]?.truncated).toBe(true);
    expect(results[1]?.truncated).toBe(true);
  });

  test("grep and ls deny paths outside the sandbox", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-jail-"));
    const tools = registryWithBuiltins();

    for (const name of ["grep", "ls"]) {
      const result = await requiredTool(tools, name).execute(
        { pattern: "secret", path: ".." },
        ctx(root),
      );
      expect(result.denied).toBe(true);
    }
  });
});
