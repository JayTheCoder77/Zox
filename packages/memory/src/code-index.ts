import type { Database } from "bun:sqlite";
import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const CHUNK_LINES = 80;
const OVERLAP = 10;
const STEP = CHUNK_LINES - OVERLAP;
const SKIP_DIRS = new Set(["node_modules", ".git", ".zox"]);

export async function indexWorkspace(opts: {
  db: Database;
  workspaceRoot: string;
  sandboxRoot: string;
}): Promise<{ chunks: number }> {
  const sandbox = await resolvePath(opts.sandboxRoot);
  const files = await listIndexFiles(opts.workspaceRoot, sandbox);
  opts.db.run("DELETE FROM code_chunks WHERE workspace_root = ?", [
    opts.workspaceRoot,
  ]);
  let chunks = 0;
  const insert = opts.db.query(
    `INSERT INTO code_chunks (workspace_root, path, start_line, text)
     VALUES (?, ?, ?, ?)`,
  );
  for (const absPath of files) {
    const data = new Uint8Array(await Bun.file(absPath).arrayBuffer());
    if (data.includes(0)) continue;
    const text = new TextDecoder().decode(data);
    const lines = text.split("\n");
    if (lines.length === 1 && lines[0] === "") continue;
    const displayPath = relative(sandbox, absPath) || absPath;
    for (let start = 0; start < lines.length; start += STEP) {
      const slice = lines.slice(start, start + CHUNK_LINES);
      if (slice.length === 0) break;
      const chunkText = slice.join("\n");
      if (chunkText.trim().length === 0) continue;
      insert.run(opts.workspaceRoot, displayPath, start + 1, chunkText);
      chunks += 1;
      if (start + CHUNK_LINES >= lines.length) break;
    }
  }
  return { chunks };
}

export function searchCode(opts: {
  db: Database;
  query: string;
  limit?: number;
}): Array<{ path: string; startLine: number; text: string; rank: number }> {
  const query = opts.query.trim();
  if (!query) return [];
  const limit = opts.limit ?? 8;
  return opts.db
    .query<
      { path: string; start_line: number; text: string; rank: number },
      [string, number]
    >(
      `SELECT code_chunks.path, code_chunks.start_line, code_chunks.text,
              bm25(code_chunks_fts) AS rank
       FROM code_chunks
       JOIN code_chunks_fts ON code_chunks.id = code_chunks_fts.rowid
       WHERE code_chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit)
    .map((row) => ({
      path: row.path,
      startLine: row.start_line,
      text: row.text,
      rank: row.rank,
    }));
}

export function codeChunkCount(db: Database): number {
  return (
    db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM code_chunks").get()
      ?.n ?? 0
  );
}

async function listIndexFiles(
  workspaceRoot: string,
  sandboxRoot: string,
): Promise<string[]> {
  const sandbox = await resolvePath(sandboxRoot);
  const workspace = await resolvePath(workspaceRoot);
  const gitRoot =
    (await gitWorkTree(sandbox)) ?? (await gitWorkTree(workspace));
  if (gitRoot) {
    const listed = await gitLsFiles(gitRoot);
    const resolvedGit = await resolvePath(gitRoot);
    return listed
      .map((rel) => join(resolvedGit, rel))
      .filter((abs) => isInside(sandbox, abs) && !shouldSkipPath(abs));
  }
  return walkFiles(sandbox);
}

async function resolvePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

async function gitWorkTree(root: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return undefined;
  const top = stdout.trim();
  return top.length > 0 ? top : undefined;
}

async function gitLsFiles(root: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "-C", root, "ls-files"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await rec(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  await rec(root);
  return out;
}

function shouldSkipPath(abs: string): boolean {
  return abs.split(sep).some((part) => SKIP_DIRS.has(part));
}

function isInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return (
    rel === "" || (!rel.startsWith("..") && !join(rel).startsWith(`..${sep}`))
  );
}
