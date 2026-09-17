import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, migrate } from "@zox/session";
import { indexWorkspace, searchCode } from "./code-index.ts";

function memoryDb(): Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("code index", () => {
  test("indexes a ts file and finds a symbol via FTS", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-idx-"));
    await writeFile(
      join(root, "hello.ts"),
      "export function findMe() { return 1 }\n",
    );
    const db = new Database(":memory:");
    migrate(db);
    await indexWorkspace({ db, workspaceRoot: root, sandboxRoot: root });
    const hits = searchCode({ db, query: "findMe" });
    expect(hits[0]?.path).toContain("hello.ts");
  });

  test("SCHEMA_VERSION is 7 and creates code_chunks FTS", () => {
    expect(SCHEMA_VERSION).toBe(7);
    const db = memoryDb();
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') OR type = 'table'",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toContain("code_chunks");
    expect(tables).toContain("code_chunks_fts");
  });

  test("skips node_modules, .git, .zox, and binary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-idx-skip-"));
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".zox"), { recursive: true });
    await writeFile(
      join(root, "keep.ts"),
      "export function keepSymbol() { return 1 }\n",
    );
    await writeFile(
      join(root, "node_modules", "dep.ts"),
      "export function skipMod() { return 1 }\n",
    );
    await writeFile(
      join(root, ".git", "hook.ts"),
      "export function skipGit() { return 1 }\n",
    );
    await writeFile(
      join(root, ".zox", "hidden.ts"),
      "export function skipZox() { return 1 }\n",
    );
    await writeFile(join(root, "blob.bin"), Buffer.from([0, 1, 2, 255, 0]));
    const db = memoryDb();
    await indexWorkspace({ db, workspaceRoot: root, sandboxRoot: root });
    expect(searchCode({ db, query: "keepSymbol" })[0]?.path).toContain(
      "keep.ts",
    );
    expect(searchCode({ db, query: "skipMod" })).toEqual([]);
    expect(searchCode({ db, query: "skipGit" })).toEqual([]);
    expect(searchCode({ db, query: "skipZox" })).toEqual([]);
  });

  test("chunks about 80 lines with overlap 10", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-idx-chunk-"));
    const lines = Array.from({ length: 90 }, (_, i) => `line_${i + 1}_token`);
    await writeFile(join(root, "long.ts"), `${lines.join("\n")}\n`);
    const db = memoryDb();
    const result = await indexWorkspace({
      db,
      workspaceRoot: root,
      sandboxRoot: root,
    });
    expect(result.chunks).toBe(2);
    const hits = db
      .query<{ start_line: number; text: string }, []>(
        "SELECT start_line, text FROM code_chunks ORDER BY start_line",
      )
      .all();
    expect(hits[0]?.start_line).toBe(1);
    expect(hits[1]?.start_line).toBe(71);
    expect(hits[0]?.text).toContain("line_1_token");
    expect(hits[0]?.text).toContain("line_80_token");
    expect(hits[1]?.text).toContain("line_71_token");
    expect(hits[1]?.text).toContain("line_90_token");
  });

  test("respects gitignore via git ls-files", async () => {
    const root = await mkdtemp(join(import.meta.dir, "zox-idx-git-"));
    try {
      await writeFile(
        join(root, "tracked.ts"),
        "export function trackedFn() {}\n",
      );
      await writeFile(
        join(root, "ignored.ts"),
        "export function ignoredFn() {}\n",
      );
      await writeFile(join(root, ".gitignore"), "ignored.ts\n");
      const init = Bun.spawn(["git", "init"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await init.exited).toBe(0);
      await Bun.spawn(["git", "config", "user.email", "zox@example.com"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      await Bun.spawn(["git", "config", "user.name", "Zox"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      const add = Bun.spawn(["git", "add", "tracked.ts", ".gitignore"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await add.exited).toBe(0);
      const db = memoryDb();
      await indexWorkspace({ db, workspaceRoot: root, sandboxRoot: root });
      expect(searchCode({ db, query: "trackedFn" })[0]?.path).toContain(
        "tracked.ts",
      );
      expect(searchCode({ db, query: "ignoredFn" })).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("searchCode defaults limit to 8", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-idx-limit-"));
    for (let i = 0; i < 12; i++) {
      await writeFile(
        join(root, `f${i}.ts`),
        `export function sharedToken_${i}() { return "sharedToken" }\n`,
      );
    }
    const db = memoryDb();
    await indexWorkspace({ db, workspaceRoot: root, sandboxRoot: root });
    const hits = searchCode({ db, query: "sharedToken" });
    expect(hits.length).toBe(8);
    const more = searchCode({ db, query: "sharedToken", limit: 10 });
    expect(more.length).toBe(10);
  });
});
