import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type CreateSessionInput,
  createId,
  createStoredSession,
  type ListSessionsInput,
  type SessionStore,
  type StoredMessage,
  type StoredSession,
  type UsageRow,
} from "@zox/core";
import { parseSkillMarkdown } from "@zox/skills";
import { migrate } from "./schema.ts";

export type SqliteSessionStoreOptions = {
  path?: string;
  workspaceRoot?: string;
};

export function resolveSessionDbPath(opts: {
  workspaceRoot: string;
  dbPath?: string;
}): string {
  if (opts.dbPath !== undefined && opts.dbPath !== "") {
    return opts.dbPath;
  }
  const fromEnv = process.env.ZOXX_DB_PATH;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  return join(opts.workspaceRoot, ".zox/state.sqlite");
}

type SessionRow = {
  id: string;
  workspace_root: string;
  agent: string;
  model: string;
  status: string;
  sandbox_root: string;
  sandbox_mode: string;
  plan_json: string | null;
  prior_state_markdown: string | null;
  system_notes: string | null;
  last_trace_id: string | null;
  window_warned: number | null;
  usage_input_tokens: number;
  usage_output_tokens: number;
  created_at: number;
  active_skills: string | null;
};

type MessageRow = {
  id: string;
  role: string;
  content: string;
  tool_call_id: string | null;
  name: string | null;
  tool_calls: string | null;
};

type UsageDbRow = {
  id: string;
  session_id: string;
  turn_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  duration_ms: number;
  estimated_usd: number | null;
};

type CompactionRow = {
  from_message_id: string;
  to_message_id: string;
  summary: string;
};

const STATUSES = new Set<StoredSession["status"]>([
  "idle",
  "running",
  "compacting",
  "awaiting_permission",
  "error",
]);

const SANDBOX_MODES = new Set<StoredSession["sandboxMode"]>([
  "host",
  "worktree",
  "container",
  "remote",
]);

const MESSAGE_ROLES = new Set<StoredMessage["role"]>([
  "user",
  "assistant",
  "system",
  "tool",
]);

type ActiveSkill = NonNullable<StoredSession["activeSkills"]>[number];

export class SqliteSessionStore implements SessionStore {
  readonly db: Database;

  constructor(opts: SqliteSessionStoreOptions = {}) {
    const path = resolveSessionDbPath({
      workspaceRoot: opts.workspaceRoot ?? process.cwd(),
      dbPath: opts.path,
    });
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    migrate(this.db);
  }

  create(input: CreateSessionInput): StoredSession {
    const session = createStoredSession(input);
    this.save(session);
    return session;
  }

  get(id: string): StoredSession | undefined {
    const row = this.db
      .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    if (!row) return undefined;

    const messages = this.db
      .query<MessageRow, [string]>(
        "SELECT id, role, content, tool_call_id, name, tool_calls FROM messages WHERE session_id = ? ORDER BY seq ASC",
      )
      .all(id)
      .map(fromMessageRow);

    const compactionRows = this.db
      .query<CompactionRow, [string]>(
        "SELECT from_message_id, to_message_id, summary FROM compactions WHERE session_id = ? ORDER BY seq ASC",
      )
      .all(id);

    const session: StoredSession = {
      id: row.id,
      workspaceRoot: row.workspace_root,
      sandboxRoot: row.sandbox_root,
      sandboxMode: asSandboxMode(row.sandbox_mode),
      planJson: row.plan_json
        ? (JSON.parse(row.plan_json) as StoredSession["planJson"])
        : null,
      usage: {
        inputTokens: row.usage_input_tokens,
        outputTokens: row.usage_output_tokens,
      },
      agent: row.agent,
      model: row.model,
      status: asStatus(row.status),
      messages,
      createdAt: row.created_at,
    };

    if (row.last_trace_id !== null) {
      session.lastTraceId = row.last_trace_id;
    }
    if (row.window_warned !== null) {
      session.windowWarned = row.window_warned === 1;
    }
    if (row.prior_state_markdown !== null) {
      session.priorStateMarkdown = row.prior_state_markdown;
    }
    if (row.system_notes) {
      const parsed: unknown = JSON.parse(row.system_notes);
      if (Array.isArray(parsed)) {
        session.systemNotes = parsed.filter((n) => typeof n === "string");
      }
    }
    const activeSkills = restoreActiveSkills(row.active_skills);
    if (activeSkills !== undefined) {
      session.activeSkills = activeSkills;
    }
    if (compactionRows.length > 0) {
      session.compactions = compactionRows.map((c) => ({
        fromMessageId: c.from_message_id,
        toMessageId: c.to_message_id,
        summary: c.summary,
      }));
    }
    return session;
  }

  list(opts: ListSessionsInput): StoredSession[] {
    const limit = opts.limit ?? 50;
    const rows = this.db
      .query<SessionRow, [string, number]>(
        "SELECT * FROM sessions WHERE workspace_root = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(opts.workspaceRoot, limit);
    return rows.flatMap((row) => {
      const session = this.get(row.id);
      return session ? [session] : [];
    });
  }

  save(session: StoredSession): void {
    const now = Date.now();
    const createdAt = session.createdAt ?? now;
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO sessions (
            id, workspace_root, agent, model, status, sandbox_root, sandbox_mode,
            plan_json, prior_state_markdown, system_notes, last_trace_id, window_warned,
            usage_input_tokens, usage_output_tokens, created_at, active_skills
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workspace_root = excluded.workspace_root,
            agent = excluded.agent,
            model = excluded.model,
            status = excluded.status,
            sandbox_root = excluded.sandbox_root,
            sandbox_mode = excluded.sandbox_mode,
            plan_json = excluded.plan_json,
            prior_state_markdown = excluded.prior_state_markdown,
            system_notes = excluded.system_notes,
            last_trace_id = excluded.last_trace_id,
            window_warned = excluded.window_warned,
            usage_input_tokens = excluded.usage_input_tokens,
            usage_output_tokens = excluded.usage_output_tokens,
            active_skills = excluded.active_skills`,
        )
        .run(
          session.id,
          session.workspaceRoot,
          session.agent,
          session.model,
          session.status,
          session.sandboxRoot,
          session.sandboxMode,
          session.planJson ? JSON.stringify(session.planJson) : null,
          session.priorStateMarkdown ?? null,
          session.systemNotes?.length
            ? JSON.stringify(session.systemNotes)
            : null,
          session.lastTraceId ?? null,
          session.windowWarned === undefined
            ? null
            : session.windowWarned
              ? 1
              : 0,
          session.usage.inputTokens,
          session.usage.outputTokens,
          createdAt,
          serializeActiveSkills(session.activeSkills),
        );

      this.db
        .query("DELETE FROM messages WHERE session_id = ?")
        .run(session.id);
      const insertMessage = this.db.query(
        `INSERT INTO messages (
          id, session_id, role, content, tool_call_id, name, tool_calls, seq, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      session.messages.forEach((message, seq) => {
        insertMessage.run(
          message.id,
          session.id,
          message.role,
          message.content,
          message.toolCallId ?? null,
          message.name ?? null,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          seq,
          now,
        );
      });

      this.db
        .query("DELETE FROM compactions WHERE session_id = ?")
        .run(session.id);
      const insertCompact = this.db.query(
        `INSERT INTO compactions (
          id, session_id, from_message_id, to_message_id, summary, seq, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      (session.compactions ?? []).forEach((compact, seq) => {
        insertCompact.run(
          createId("cmp"),
          session.id,
          compact.fromMessageId,
          compact.toMessageId,
          compact.summary,
          seq,
          now,
        );
      });
    })();
  }

  addUsage(sessionId: string, rec: UsageRow): void {
    this.db
      .query(
        `INSERT INTO usage (
          id, session_id, turn_id, provider, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, duration_ms, estimated_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.id,
        sessionId,
        rec.turnId,
        rec.provider,
        rec.model,
        rec.inputTokens,
        rec.outputTokens,
        rec.cacheReadTokens ?? null,
        rec.cacheWriteTokens ?? null,
        rec.durationMs,
        rec.estimatedUsd ?? null,
      );
  }

  listUsage(sessionId: string): UsageRow[] {
    return this.db
      .query<UsageDbRow, [string]>(
        "SELECT * FROM usage WHERE session_id = ? ORDER BY rowid ASC",
      )
      .all(sessionId)
      .map((row) => {
        const rec: UsageRow = {
          id: row.id,
          sessionId: row.session_id,
          turnId: row.turn_id,
          provider: row.provider,
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          durationMs: row.duration_ms,
        };
        if (row.cache_read_tokens !== null) {
          rec.cacheReadTokens = row.cache_read_tokens;
        }
        if (row.cache_write_tokens !== null) {
          rec.cacheWriteTokens = row.cache_write_tokens;
        }
        if (row.estimated_usd !== null) {
          rec.estimatedUsd = row.estimated_usd;
        }
        return rec;
      });
  }
}

function serializeActiveSkills(
  skills: StoredSession["activeSkills"],
): string | null {
  if (!skills?.length) return null;
  return JSON.stringify(
    skills.map((skill) => {
      const stored: { name: string; body: string; path?: string } = {
        name: skill.name,
        body: skill.body,
      };
      if (skill.path !== undefined) stored.path = skill.path;
      return stored;
    }),
  );
}

function restoreActiveSkills(raw: string | null): ActiveSkill[] | undefined {
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { name?: unknown }).name !== "string" ||
      typeof (item as { body?: unknown }).body !== "string"
    ) {
      return [];
    }
    const stored = item as { name: string; body: string; path?: unknown };
    const skill: ActiveSkill = { name: stored.name, body: stored.body };
    if (typeof stored.path === "string") {
      skill.path = stored.path;
      if (existsSync(stored.path)) {
        try {
          const fromDisk = parseSkillMarkdown(
            readFileSync(stored.path, "utf8"),
            stored.path,
          );
          skill.name = fromDisk.name;
          skill.body = fromDisk.body;
        } catch {
          // Keep the stored body if the file cannot be re-read.
        }
      }
    }
    return [skill];
  });
}

function fromMessageRow(row: MessageRow): StoredMessage {
  const message: StoredMessage = {
    id: row.id,
    role: asMessageRole(row.role),
    content: row.content,
  };
  if (row.tool_call_id !== null) message.toolCallId = row.tool_call_id;
  if (row.name !== null) message.name = row.name;
  if (row.tool_calls !== null) {
    message.toolCalls = JSON.parse(
      row.tool_calls,
    ) as StoredMessage["toolCalls"];
  }
  return message;
}

function asStatus(value: string): StoredSession["status"] {
  if (STATUSES.has(value as StoredSession["status"])) {
    return value as StoredSession["status"];
  }
  return "idle";
}

function asSandboxMode(value: string): StoredSession["sandboxMode"] {
  if (SANDBOX_MODES.has(value as StoredSession["sandboxMode"])) {
    return value as StoredSession["sandboxMode"];
  }
  return "worktree";
}

function asMessageRole(value: string): StoredMessage["role"] {
  if (MESSAGE_ROLES.has(value as StoredMessage["role"])) {
    return value as StoredMessage["role"];
  }
  return "user";
}
