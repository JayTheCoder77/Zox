import type { Database } from "bun:sqlite";

export const SCHEMA_VERSION = 4;

const V1 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  sandbox_root TEXT NOT NULL,
  sandbox_mode TEXT NOT NULL,
  plan_json TEXT,
  prior_state_markdown TEXT,
  last_trace_id TEXT,
  window_warned INTEGER,
  usage_input_tokens INTEGER NOT NULL DEFAULT 0,
  usage_output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  name TEXT,
  tool_calls TEXT,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  duration_ms INTEGER NOT NULL,
  estimated_usd REAL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  from_message_id TEXT NOT NULL,
  to_message_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
`;

export function migrate(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    );
  `);
  const row = db
    .query<{ version: number | null }, []>(
      "SELECT MAX(version) AS version FROM schema_migrations",
    )
    .get();
  const current = row?.version ?? 0;
  if (current < 1) {
    db.exec(V1);
    db.run("INSERT INTO schema_migrations (version) VALUES (?)", [1]);
  }
  if (current < 2) {
    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(sessions)")
      .all();
    if (!columns.some((col) => col.name === "system_notes")) {
      db.exec("ALTER TABLE sessions ADD COLUMN system_notes TEXT");
    }
    db.run("INSERT INTO schema_migrations (version) VALUES (?)", [2]);
  }
  if (current < 3) {
    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(sessions)")
      .all();
    if (!columns.some((col) => col.name === "active_skills")) {
      db.exec("ALTER TABLE sessions ADD COLUMN active_skills TEXT");
    }
    db.run("INSERT INTO schema_migrations (version) VALUES (?)", [3]);
  }
  if (current < 4) {
    db.exec(`
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  scope TEXT NOT NULL,
  tags TEXT,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  path TEXT,
  updated_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`);
    db.run("INSERT INTO schema_migrations (version) VALUES (?)", [4]);
  }
}
