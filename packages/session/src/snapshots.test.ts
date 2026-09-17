import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, migrate } from "./schema.ts";
import { recordFileSnapshot, restoreSnapshot } from "./snapshots.ts";

function seedSession(db: Database, id: string): void {
  db.run(
    `INSERT INTO sessions (
      id, workspace_root, agent, model, status, sandbox_root, sandbox_mode,
      usage_input_tokens, usage_output_tokens, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    [id, "/tmp/ws", "build", "mock/echo", "idle", "/tmp/ws", "host", Date.now()],
  );
}

describe("file snapshots", () => {
  test("records prior bytes and restores them", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-snap-"));
    await writeFile(join(root, "a.txt"), "old");
    const db = new Database(":memory:");
    migrate(db);
    seedSession(db, "sess_1");
    const snap = await recordFileSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
      relativePath: "a.txt",
    });
    if ("skipped" in snap) throw new Error("should record");
    await writeFile(join(root, "a.txt"), "new");
    await restoreSnapshot({
      db,
      sessionId: "sess_1",
      snapshotId: snap.id,
      sandboxRoot: root,
    });
    expect(await Bun.file(join(root, "a.txt")).text()).toBe("old");
  });

  test("missing file snapshots empty blob and restore unlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-snap-miss-"));
    const db = new Database(":memory:");
    migrate(db);
    seedSession(db, "sess_1");
    const snap = await recordFileSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
      relativePath: "created.txt",
    });
    if ("skipped" in snap) throw new Error("should record");
    await writeFile(join(root, "created.txt"), "new file");
    await restoreSnapshot({
      db,
      sessionId: "sess_1",
      snapshotId: snap.id,
      sandboxRoot: root,
    });
    expect(await Bun.file(join(root, "created.txt")).exists()).toBe(false);
  });

  test("skips paths that fail the sandbox jail", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-snap-jail-"));
    const db = new Database(":memory:");
    migrate(db);
    const snap = await recordFileSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
      relativePath: "../secret.txt",
    });
    expect(snap).toEqual({ skipped: true });
  });

  test("restore without snapshotId uses latest for the session", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-snap-latest-"));
    await writeFile(join(root, "a.txt"), "first");
    const db = new Database(":memory:");
    migrate(db);
    seedSession(db, "sess_1");
    const older = await recordFileSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
      relativePath: "a.txt",
    });
    if ("skipped" in older) throw new Error("should record");
    await writeFile(join(root, "a.txt"), "second");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newer = await recordFileSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
      relativePath: "a.txt",
    });
    if ("skipped" in newer) throw new Error("should record");
    await writeFile(join(root, "a.txt"), "third");
    const restored = await restoreSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
    });
    expect(restored.snapshotId).toBe(newer.id);
    expect(await Bun.file(join(root, "a.txt")).text()).toBe("second");
  });

  test("restore rejects a snapshot from another session", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-snap-sess-"));
    await writeFile(join(root, "a.txt"), "old");
    const db = new Database(":memory:");
    migrate(db);
    seedSession(db, "sess_1");
    const snap = await recordFileSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
      relativePath: "a.txt",
    });
    if ("skipped" in snap) throw new Error("should record");
    await expect(
      restoreSnapshot({
        db,
        sessionId: "sess_2",
        snapshotId: snap.id,
        sandboxRoot: root,
      }),
    ).rejects.toThrow("Snapshot not found");
  });
});

describe("SCHEMA_VERSION", () => {
  test("is 7 and creates file_snapshots and code_chunks", () => {
    expect(SCHEMA_VERSION).toBe(7);
    const db = new Database(":memory:");
    migrate(db);
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toContain("file_snapshots");
    expect(tables).toContain("code_chunks");
    expect(tables).toContain("code_chunks_fts");
  });
});
