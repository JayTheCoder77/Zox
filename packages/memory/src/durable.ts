import type { Database } from "bun:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type DurableMemory = {
  id: string;
  workspaceRoot: string;
  scope: string;
  tags: string | null;
  content: string;
  pinned: boolean;
  path: string | null;
  updatedAt: number;
};

type MemoryRow = {
  id: string;
  workspace_root: string;
  scope: string;
  tags: string | null;
  content: string;
  pinned: number;
  path: string | null;
  updated_at: number;
};

const PROJECT_FACTS = ".zox/memory/project-facts.md";

export async function writeDurableMemory(
  db: Database,
  input: {
    content: string;
    workspaceRoot: string;
    pinned?: boolean;
    scope?: "project" | "user";
  },
): Promise<DurableMemory> {
  const content = input.content.trim();
  const pinned = input.pinned === true;
  const scope = input.scope ?? "project";
  const id = `mem_${crypto.randomUUID()}`;
  const updatedAt = Date.now();
  let path: string | null = null;

  if (pinned && scope === "project") {
    path = PROJECT_FACTS;
    await appendProjectFact(input.workspaceRoot, content);
  }

  db.run(
    `INSERT INTO memories (id, workspace_root, scope, tags, content, pinned, path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.workspaceRoot,
      scope,
      null,
      content,
      pinned ? 1 : 0,
      path,
      updatedAt,
    ],
  );

  return {
    id,
    workspaceRoot: input.workspaceRoot,
    scope,
    tags: null,
    content,
    pinned,
    path,
    updatedAt,
  };
}

export function searchDurableMemories(
  db: Database,
  query: string,
  workspaceRoot: string,
): DurableMemory[] {
  const q = query.trim();
  if (!q) return [];
  const rows = db
    .query<MemoryRow, [string, string]>(
      `SELECT memories.id, memories.workspace_root, memories.scope, memories.tags,
              memories.content, memories.pinned, memories.path, memories.updated_at
       FROM memories
       JOIN memories_fts ON memories.rowid = memories_fts.rowid
       WHERE memories.workspace_root = ?
         AND memories_fts MATCH ?
       ORDER BY memories.pinned DESC, rank`,
    )
    .all(workspaceRoot, q);
  return rows.map(fromRow);
}

export async function loadStartupMemories(opts: {
  db: Database;
  workspaceRoot: string;
  startupInjectCount?: number;
  autoInject?: string[];
  userMemoryDir?: string;
}): Promise<{ notes: string[]; injectedDurableIds: string[] }> {
  const limit = opts.startupInjectCount ?? 5;
  const rows = opts.db
    .query<MemoryRow, [string, number]>(
      `SELECT id, workspace_root, scope, tags, content, pinned, path, updated_at
       FROM memories
       WHERE workspace_root = ?
       ORDER BY pinned DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(opts.workspaceRoot, limit);

  const notes: string[] = rows.map((row) => row.content);
  const injectedDurableIds = rows.map((row) => row.id);

  const userDir = opts.userMemoryDir ?? join(homedir(), ".config/zox/memory");
  for (const name of opts.autoInject ?? []) {
    const fileName = basename(name);
    const projectPath = join(opts.workspaceRoot, ".zox/memory", fileName);
    const userPath = join(userDir, fileName);
    const projectText = await readOptional(projectPath);
    const userText = await readOptional(userPath);
    if (projectText !== undefined) notes.push(projectText);
    if (userText !== undefined && userText !== projectText)
      notes.push(userText);
  }

  return { notes, injectedDurableIds };
}

async function appendProjectFact(
  workspaceRoot: string,
  content: string,
): Promise<void> {
  const dir = join(workspaceRoot, ".zox/memory");
  await mkdir(dir, { recursive: true });
  const filePath = join(workspaceRoot, PROJECT_FACTS);
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(filePath, `${existing}${prefix}- ${content}\n`, "utf8");
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function fromRow(row: MemoryRow): DurableMemory {
  return {
    id: row.id,
    workspaceRoot: row.workspace_root,
    scope: row.scope,
    tags: row.tags,
    content: row.content,
    pinned: row.pinned === 1,
    path: row.path,
    updatedAt: row.updated_at,
  };
}
