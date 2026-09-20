import type { CompactResult } from "@zox/context";
import type { CreateSessionRequest, SessionStatus } from "@zox/contracts";
import type { PlanItem } from "@zox/memory";
import type { ToolCall } from "@zox/providers";
import { createId } from "./ids.ts";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCall[];
};

export type ActiveSkill = { name: string; body: string; path?: string };

export type UsageRow = {
  id: string;
  sessionId: string;
  turnId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs: number;
  estimatedUsd?: number;
};

export type StoredSession = {
  id: string;
  workspaceRoot: string;
  sandboxRoot: string;
  sandboxMode: "host" | "worktree" | "container" | "remote";
  planJson: PlanItem[] | null;
  usage: { inputTokens: number; outputTokens: number };
  turnCount?: number;
  usageUsd?: number;
  lastTraceId?: string;
  windowWarned?: boolean;
  priorStateMarkdown?: string;
  softPreCompactPending?: boolean;
  agent: string;
  model: string;
  status: SessionStatus;
  messages: StoredMessage[];
  compactions?: CompactResult[];
  activeSkills?: ActiveSkill[];
  systemNotes?: string[];
  createdAt?: number;
};

export type CreateSessionInput = Omit<
  CreateSessionRequest,
  "agent" | "model"
> & {
  agent: string;
  model: string;
  sandboxRoot?: string;
};

export type ListSessionsInput = {
  workspaceRoot: string;
  limit?: number;
};

export interface SessionStore {
  create(input: CreateSessionInput): StoredSession;
  get(id: string): StoredSession | undefined;
  save(session: StoredSession): void;
  list(opts: ListSessionsInput): StoredSession[];
  addUsage(sessionId: string, rec: UsageRow): void;
  listUsage(sessionId: string): UsageRow[];
}

export function createStoredSession(input: CreateSessionInput): StoredSession {
  return {
    id: createId("sess"),
    workspaceRoot: input.workspaceRoot,
    sandboxRoot: input.sandboxRoot ?? input.workspaceRoot,
    sandboxMode: "worktree",
    planJson: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    turnCount: 0,
    usageUsd: 0,
    agent: input.agent,
    model: input.model,
    status: "idle",
    messages: [],
    createdAt: Date.now(),
  };
}

export class MemorySessionStore implements SessionStore {
  #sessions = new Map<string, StoredSession>();
  #usage = new Map<string, UsageRow[]>();

  create(input: CreateSessionInput): StoredSession {
    const session = createStoredSession(input);
    this.#sessions.set(session.id, session);
    return session;
  }

  get(id: string): StoredSession | undefined {
    return this.#sessions.get(id);
  }

  save(session: StoredSession): void {
    this.#sessions.set(session.id, session);
  }

  list(opts: ListSessionsInput): StoredSession[] {
    const limit = opts.limit ?? 50;
    return [...this.#sessions.values()]
      .filter((session) => session.workspaceRoot === opts.workspaceRoot)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, limit);
  }

  addUsage(sessionId: string, rec: UsageRow): void {
    const rows = this.#usage.get(sessionId) ?? [];
    rows.push(rec);
    this.#usage.set(sessionId, rows);
  }

  listUsage(sessionId: string): UsageRow[] {
    return this.#usage.get(sessionId) ?? [];
  }

  update(
    id: string,
    patch: Partial<Pick<StoredSession, "status" | "messages" | "compactions">>,
  ): StoredSession {
    const current = this.#sessions.get(id);
    if (!current) {
      throw new Error(`Unknown session: ${id}`);
    }
    const next = { ...current, ...patch };
    this.#sessions.set(id, next);
    return next;
  }
}
