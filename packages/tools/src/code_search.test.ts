import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "@zox/session";
import { createBuiltinTools } from "./builtins.ts";
import { codeSearchTool } from "./code_search.ts";

function ctx(root: string, db: Database) {
  return {
    sandboxRoot: root,
    maxToolOutputChars: 32_000,
    memoryDb: db,
    session: { id: "s", workspaceRoot: root, agent: "build" },
  };
}

describe("code_search tool", () => {
  test("registers with query and optional limit", () => {
    expect(codeSearchTool.name).toBe("code_search");
    expect(codeSearchTool.parameters).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    });
    expect(createBuiltinTools().some((tool) => tool.name === "code_search")).toBe(
      true,
    );
  });

  test("indexes on first search when chunks are empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cs-"));
    await writeFile(
      join(root, "hello.ts"),
      "export function findMe() { return 1 }\n",
    );
    const db = new Database(":memory:");
    migrate(db);
    const result = await codeSearchTool.execute(
      { query: "findMe" },
      ctx(root, db),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("hello.ts");
    expect(result.content).toContain("findMe");
  });

  test("does not rebuild when chunks already exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cs-skip-"));
    await writeFile(
      join(root, "hello.ts"),
      "export function findMe() { return 1 }\n",
    );
    const db = new Database(":memory:");
    migrate(db);
    await codeSearchTool.execute({ query: "findMe" }, ctx(root, db));
    await writeFile(
      join(root, "later.ts"),
      "export function laterSymbol() { return 2 }\n",
    );
    const result = await codeSearchTool.execute(
      { query: "laterSymbol" },
      ctx(root, db),
    );
    expect(result.ok).toBe(true);
    expect(result.content).not.toContain("later.ts");
  });

  test("rejects invalid arguments", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cs-bad-"));
    const db = new Database(":memory:");
    migrate(db);
    const result = await codeSearchTool.execute({}, ctx(root, db));
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Invalid arguments");
  });
});
