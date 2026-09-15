import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionStore, StoredSession, UsageRow } from "@zox/core";
import { resolveSessionDbPath, SqliteSessionStore } from "./sqlite.ts";

function usage(
  partial: Partial<UsageRow> & Pick<UsageRow, "id" | "sessionId">,
): UsageRow {
  return {
    turnId: "turn_1",
    provider: "mock",
    model: "mock/echo",
    inputTokens: 10,
    outputTokens: 4,
    durationMs: 12,
    ...partial,
  };
}

function assertSessionStore(store: SessionStore): SessionStore {
  return store;
}

describe("resolveSessionDbPath", () => {
  const previous = process.env.ZOXX_DB_PATH;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.ZOXX_DB_PATH;
    } else {
      process.env.ZOXX_DB_PATH = previous;
    }
  });

  test("defaults to workspace .zox/state.sqlite", () => {
    delete process.env.ZOXX_DB_PATH;
    expect(resolveSessionDbPath({ workspaceRoot: "/tmp/ws" })).toBe(
      join("/tmp/ws", ".zox/state.sqlite"),
    );
  });

  test("prefers ZOXX_DB_PATH", () => {
    process.env.ZOXX_DB_PATH = "/custom/zox.sqlite";
    expect(resolveSessionDbPath({ workspaceRoot: "/tmp/ws" })).toBe(
      "/custom/zox.sqlite",
    );
  });

  test("explicit path wins over env", () => {
    process.env.ZOXX_DB_PATH = "/custom/zox.sqlite";
    expect(
      resolveSessionDbPath({ workspaceRoot: "/tmp/ws", dbPath: ":memory:" }),
    ).toBe(":memory:");
  });
});

describe("SqliteSessionStore", () => {
  test("satisfies SessionStore", () => {
    const store = new SqliteSessionStore({ path: ":memory:" });
    expect(assertSessionStore(store)).toBe(store);
  });

  test("create / get round-trip on :memory:", () => {
    const store = new SqliteSessionStore({ path: ":memory:" });
    const created = store.create({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
      sandboxRoot: "/tmp/ws/.zox/worktrees/sess",
    });
    expect(created.status).toBe("idle");
    expect(created.messages).toEqual([]);
    expect(created.sandboxRoot).toBe("/tmp/ws/.zox/worktrees/sess");
    expect(created.sandboxMode).toBe("worktree");
    expect(created.planJson).toBeNull();
    expect(created.usage).toEqual({ inputTokens: 0, outputTokens: 0 });

    const loaded = store.get(created.id);
    expect(loaded).toEqual(created);
  });

  test("returns undefined for unknown ids", () => {
    const store = new SqliteSessionStore({ path: ":memory:" });
    expect(store.get("missing")).toBeUndefined();
  });

  test("save persists messages, plan, usage totals, and extra fields", () => {
    const store = new SqliteSessionStore({ path: ":memory:" });
    const created = store.create({
      workspaceRoot: "/tmp/ws",
      agent: "plan",
      model: "mock/echo",
    });
    const next: StoredSession = {
      ...created,
      status: "idle",
      sandboxMode: "host",
      lastTraceId: "trace_1",
      windowWarned: true,
      priorStateMarkdown: "prior notes",
      planJson: [{ id: "1", content: "ship", status: "pending" }],
      usage: { inputTokens: 20, outputTokens: 8 },
      messages: [
        { id: "msg_u", role: "user", content: "hello" },
        {
          id: "msg_a",
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "tc_1", name: "read", arguments: { path: "a.ts" } },
          ],
        },
        {
          id: "msg_t",
          role: "tool",
          content: "ok",
          toolCallId: "tc_1",
          name: "read",
        },
      ],
      compactions: [
        {
          fromMessageId: "msg_u",
          toMessageId: "msg_t",
          summary: "user asked then tool ran",
        },
      ],
    };
    store.save(next);
    expect(store.get(created.id)).toEqual(next);
  });

  test("addUsage / listUsage round-trip", () => {
    const store = new SqliteSessionStore({ path: ":memory:" });
    const session = store.create({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
    });
    const row = usage({
      id: "use_1",
      sessionId: session.id,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      estimatedUsd: 0.01,
    });
    store.addUsage(session.id, row);
    expect(store.listUsage(session.id)).toEqual([row]);
    expect(store.listUsage("other")).toEqual([]);
  });

  test("schema has required tables and never stores API keys", () => {
    const store = new SqliteSessionStore({ path: ":memory:" });
    store.create({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
    });
    const db = store.db;
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      "compactions",
      "messages",
      "schema_migrations",
      "sessions",
      "usage",
    ]);

    const columns = tables.flatMap((table) =>
      db
        .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => `${table}.${row.name}`),
    );
    expect(columns.some((name) => /api[_-]?key|secret/i.test(name))).toBe(
      false,
    );

    const sessionRow = db
      .query<Record<string, string | number | null>, []>(
        "SELECT * FROM sessions",
      )
      .get();
    expect(sessionRow).toBeDefined();
    expect(JSON.stringify(sessionRow)).not.toMatch(/api[_-]?key/i);
  });
});

describe("SqliteSessionStore schema_migrations", () => {
  test("records a migration version", () => {
    const store = new SqliteSessionStore({ path: ":memory:" });
    const versions = store.db
      .query<{ version: number }, []>(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
      .all()
      .map((row) => row.version);
    expect(versions).toEqual([1, 2]);
    expect(store.db).toBeInstanceOf(Database);
  });
});
