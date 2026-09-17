import type { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";
import { createId } from "@zox/core";
import { jailPath } from "@zox/sandbox";

export type FileSnapshot = {
  id: string;
  sessionId: string;
  path: string;
  createdAt: number;
};

type SnapshotRow = {
  id: string;
  session_id: string;
  path: string;
  bytes: Uint8Array;
  created_at: number;
};

export async function recordFileSnapshot(opts: {
  db: Database;
  sessionId: string;
  sandboxRoot: string;
  relativePath: string;
}): Promise<FileSnapshot | { skipped: true }> {
  const jailed = await jailPath(opts.sandboxRoot, opts.relativePath);
  if (!jailed.ok) return { skipped: true };

  const file = Bun.file(jailed.path);
  const bytes = (await file.exists())
    ? new Uint8Array(await file.arrayBuffer())
    : Buffer.from("");
  const id = createId("snap");
  const createdAt = Date.now();
  opts.db
    .query(
      `INSERT INTO file_snapshots (id, session_id, path, bytes, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, opts.sessionId, opts.relativePath, bytes, createdAt);
  return {
    id,
    sessionId: opts.sessionId,
    path: opts.relativePath,
    createdAt,
  };
}

export async function restoreSnapshot(opts: {
  db: Database;
  sessionId: string;
  snapshotId?: string;
  sandboxRoot: string;
}): Promise<{ path: string; snapshotId: string }> {
  const row = opts.snapshotId
    ? opts.db
        .query<SnapshotRow, [string, string]>(
          `SELECT id, session_id, path, bytes, created_at
           FROM file_snapshots
           WHERE id = ? AND session_id = ?`,
        )
        .get(opts.snapshotId, opts.sessionId)
    : opts.db
        .query<SnapshotRow, [string]>(
          `SELECT id, session_id, path, bytes, created_at
           FROM file_snapshots
           WHERE session_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(opts.sessionId);
  if (!row) throw new Error("Snapshot not found");

  const jailed = await jailPath(opts.sandboxRoot, row.path);
  if (!jailed.ok) throw new Error(jailed.reason);

  const bytes = row.bytes;
  if (bytes.byteLength === 0) {
    await unlink(jailed.path).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    });
  } else {
    await Bun.write(jailed.path, bytes);
  }
  return { path: jailed.path, snapshotId: row.id };
}
