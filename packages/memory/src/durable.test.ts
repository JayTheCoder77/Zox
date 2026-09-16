import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "@zox/session";
import {
  loadStartupMemories,
  searchDurableMemories,
  writeDurableMemory,
} from "./durable.ts";

function memoryDb(): Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("durable memory FTS", () => {
  test("write pin and unpinned; search matches; pin sorts first", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-durable-"));
    const db = memoryDb();

    const unpinned = await writeDurableMemory(db, {
      workspaceRoot,
      content: "alpha unpinned note about widgets",
      pinned: false,
    });
    const pinned = await writeDurableMemory(db, {
      workspaceRoot,
      content: "alpha pinned project fact",
      pinned: true,
    });

    expect(unpinned.pinned).toBe(false);
    expect(unpinned.scope).toBe("project");
    expect(pinned.pinned).toBe(true);
    expect(pinned.scope).toBe("project");

    const facts = await readFile(
      join(workspaceRoot, ".zox/memory/project-facts.md"),
      "utf8",
    );
    expect(facts).toContain("alpha pinned project fact");
    expect(facts).not.toContain("alpha unpinned note about widgets");

    const hits = searchDurableMemories(db, "alpha", workspaceRoot);
    expect(hits.map((hit) => hit.id)).toEqual([pinned.id, unpinned.id]);
    expect(hits[0]?.pinned).toBe(true);
    expect(hits.every((hit) => hit.content.includes("alpha"))).toBe(true);
  });

  test("loadStartupMemories injects top-k plus autoInject files", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-startup-mem-"));
    const userDir = await mkdtemp(join(tmpdir(), "zox-user-mem-"));
    const db = memoryDb();

    for (let i = 0; i < 6; i++) {
      await writeDurableMemory(db, {
        workspaceRoot,
        content: `fact-${i} unique-token`,
        pinned: i === 5,
      });
    }

    await mkdir(join(workspaceRoot, ".zox/memory"), { recursive: true });
    await writeFile(
      join(workspaceRoot, ".zox/memory/preferences.md"),
      "workspace prefs",
      "utf8",
    );
    await writeFile(join(userDir, "prefs-user.md"), "user prefs", "utf8");

    const loaded = await loadStartupMemories({
      db,
      workspaceRoot,
      startupInjectCount: 5,
      autoInject: ["preferences.md", "prefs-user.md"],
      userMemoryDir: userDir,
    });

    expect(loaded.notes.some((note) => note.includes("fact-5"))).toBe(true);
    expect(
      loaded.notes.filter((note) => note.includes("unique-token")).length,
    ).toBe(5);
    expect(loaded.notes.some((note) => note.includes("workspace prefs"))).toBe(
      true,
    );
    expect(loaded.notes.some((note) => note.includes("user prefs"))).toBe(true);
    expect(loaded.injectedDurableIds).toHaveLength(5);
  });

  test("loadStartupMemories filters durable rows to the requested workspaceRoot", async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), "zox-startup-a-"));
    const workspaceB = await mkdtemp(join(tmpdir(), "zox-startup-b-"));
    const db = memoryDb();

    const written = await writeDurableMemory(db, {
      workspaceRoot: workspaceA,
      content: "startup-isolation pin only in workspace A",
      pinned: true,
    });

    const loadedB = await loadStartupMemories({
      db,
      workspaceRoot: workspaceB,
      startupInjectCount: 5,
    });
    expect(loadedB.notes).not.toContain(written.content);
    expect(loadedB.injectedDurableIds).not.toContain(written.id);

    const loadedA = await loadStartupMemories({
      db,
      workspaceRoot: workspaceA,
      startupInjectCount: 5,
    });
    expect(loadedA.notes).toContain(written.content);
    expect(loadedA.injectedDurableIds).toEqual([written.id]);
  });

  test("search filters memories to the requested workspaceRoot", async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), "zox-durable-a-"));
    const workspaceB = await mkdtemp(join(tmpdir(), "zox-durable-b-"));
    const db = memoryDb();

    const written = await writeDurableMemory(db, {
      workspaceRoot: workspaceA,
      content: "sharedtoken pin only in workspace A",
      pinned: true,
    });
    expect(written.workspaceRoot).toBe(workspaceA);

    expect(searchDurableMemories(db, "sharedtoken", workspaceB)).toEqual([]);
    const hitsA = searchDurableMemories(db, "sharedtoken", workspaceA);
    expect(hitsA.map((hit) => hit.id)).toEqual([written.id]);
  });
});
