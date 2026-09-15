import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuiltinTools } from "./builtins.ts";
import { ToolRegistry } from "./registry.ts";
import type { ZoxTool } from "./types.ts";

async function ctx(root: string) {
  return {
    sandboxRoot: root,
    maxToolOutputChars: 32_000,
    session: { id: "s", workspaceRoot: root, agent: "build" },
  };
}

function requiredTool(tools: ToolRegistry, name: string): ZoxTool {
  const tool = tools.get(name);
  expect(tool).toBeDefined();
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe("fs tools", () => {
  test("read returns numbered lines in range", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-fs-"));
    await Bun.write(join(root, "a.ts"), "one\ntwo\nthree\n");
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const result = await requiredTool(tools, "read").execute(
      { path: "a.ts", offset: 2, limit: 1 },
      await ctx(root),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("2\ttwo");
    expect(result.content).not.toContain("one");
  });

  test("write then read round-trips and jail denies ../", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-fs-"));
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const w = await requiredTool(tools, "write").execute(
      { path: "n.txt", content: "hi" },
      await ctx(root),
    );
    expect(w.ok).toBe(true);
    const escaped = await requiredTool(tools, "read").execute(
      { path: "../secret" },
      await ctx(root),
    );
    expect(escaped.ok).toBe(false);
    expect(escaped.denied).toBe(true);
  });

  test("write creates missing parent directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-fs-"));
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);

    const result = await requiredTool(tools, "write").execute(
      { path: "nested/dir/n.txt", content: "hi" },
      await ctx(root),
    );

    expect(result.ok).toBe(true);
    expect(await Bun.file(join(root, "nested/dir/n.txt")).text()).toBe("hi");
  });

  test("edit replaces unique oldString and fails on ambiguity", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-fs-"));
    await Bun.write(join(root, "a.ts"), "foo\nfoo\n");
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const amb = await requiredTool(tools, "edit").execute(
      { path: "a.ts", oldString: "foo", newString: "bar" },
      await ctx(root),
    );
    expect(amb.ok).toBe(false);
    await Bun.write(join(root, "b.ts"), "foo\nbaz\n");
    const ok = await requiredTool(tools, "edit").execute(
      { path: "b.ts", oldString: "foo", newString: "bar" },
      await ctx(root),
    );
    expect(ok.ok).toBe(true);
    expect(await Bun.file(join(root, "b.ts")).text()).toBe("bar\nbaz\n");
  });
});
