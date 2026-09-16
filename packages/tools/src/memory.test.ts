import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "@zox/session";
import { memorySearchTool } from "./memory_search.ts";
import { memoryWriteTool } from "./memory_write.ts";
import type { ToolContext } from "./types.ts";

function ctx(
  workspaceRoot: string,
  db: Database,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    sandboxRoot: workspaceRoot,
    maxToolOutputChars: 32_000,
    session: { id: "s", workspaceRoot, agent: "build" },
    memoryDb: db,
    ...overrides,
  };
}

describe("memory_write and memory_search tools", () => {
  test("write stores an unpinned project fact searchable by query", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-mem-tool-"));
    const db = new Database(":memory:");
    migrate(db);

    const written = await memoryWriteTool.execute(
      { content: "remember the widget API uses alpha tokens" },
      ctx(workspaceRoot, db),
    );
    expect(written.ok).toBe(true);

    const found = await memorySearchTool.execute(
      { query: "alpha" },
      ctx(workspaceRoot, db),
    );
    expect(found.ok).toBe(true);
    expect(found.content).toContain("widget API");
    expect(found.content).toMatch(/unpinned|pinned:\s*false/i);
  });

  test("search ranks pinned hits first", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-mem-tool-rank-"));
    const db = new Database(":memory:");
    migrate(db);
    const { writeDurableMemory } = await import("@zox/memory");
    await writeDurableMemory(db, {
      workspaceRoot,
      content: "alpha unpinned tool fact",
      pinned: false,
    });
    await writeDurableMemory(db, {
      workspaceRoot,
      content: "alpha pinned tool fact",
      pinned: true,
    });

    const found = await memorySearchTool.execute(
      { query: "alpha" },
      ctx(workspaceRoot, db),
    );
    expect(found.ok).toBe(true);
    const pinIndex = found.content.indexOf("alpha pinned tool fact");
    const unpinIndex = found.content.indexOf("alpha unpinned tool fact");
    expect(pinIndex).toBeGreaterThanOrEqual(0);
    expect(unpinIndex).toBeGreaterThan(pinIndex);
  });

  test("memory_search does not return facts from another workspaceRoot", async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), "zox-mem-tool-a-"));
    const workspaceB = await mkdtemp(join(tmpdir(), "zox-mem-tool-b-"));
    const db = new Database(":memory:");
    migrate(db);

    const written = await memoryWriteTool.execute(
      { content: "sharedtoken tool fact only in A" },
      ctx(workspaceA, db),
    );
    expect(written.ok).toBe(true);

    const fromB = await memorySearchTool.execute(
      { query: "sharedtoken" },
      ctx(workspaceB, db),
    );
    expect(fromB.ok).toBe(true);
    expect(fromB.content).toBe("No matches");

    const fromA = await memorySearchTool.execute(
      { query: "sharedtoken" },
      ctx(workspaceA, db),
    );
    expect(fromA.ok).toBe(true);
    expect(fromA.content).toContain("sharedtoken tool fact only in A");
  });
});
