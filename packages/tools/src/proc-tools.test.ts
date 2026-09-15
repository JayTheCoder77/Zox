import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuiltinTools } from "./builtins.ts";
import { createGrepTool } from "./grep.ts";
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

  test("bash denies denylisted commands in compound commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-bash-compound-"));
    const tools = registryWithBuiltins();

    const denied = await requiredTool(tools, "bash").execute(
      { command: "echo ok; rm -rf ." },
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

  test("fallback grep jails every glob candidate", async () => {
    const parent = await mkdtemp(join(tmpdir(), "zox-grep-jail-"));
    const root = join(parent, "root");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await Bun.write(join(outside, "secret.txt"), "outside-secret\n");

    const result = await createGrepTool(() => null).execute(
      { pattern: "outside-secret", glob: "../outside/**" },
      ctx(root),
    );

    expect(result.ok).toBe(true);
    expect(result.content).toBe("");
  });

  test("fallback grep uses JavaScript regular expressions", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-grep-regex-"));
    await Bun.write(join(root, "values.txt"), "value-123\nvalue-abc\n");
    const grep = createGrepTool(() => null);

    const result = await grep.execute(
      { pattern: String.raw`value-\d+` },
      ctx(root),
    );
    const invalid = await grep.execute({ pattern: "[" }, ctx(root));

    expect(result.ok).toBe(true);
    expect(result.content).toContain("value-123");
    expect(result.content).not.toContain("value-abc");
    expect(invalid.ok).toBe(false);
    expect(invalid.content).toContain("Invalid regular expression");
  });

  test("grep returns truncated rg stdout despite a nonzero exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-grep-rg-cap-"));
    await Bun.write(join(root, "many.txt"), "match\n".repeat(60_000));

    const result = await requiredTool(registryWithBuiltins(), "grep").execute(
      { pattern: "match" },
      ctx(root, 300_000),
    );

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("many.txt:1:match");
    expect(result.content).not.toContain("Search failed");
  });
});
