import type { CreateSessionRequest, SessionStatus } from "@zox/contracts";
import { createId } from "./ids.ts";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type StoredSession = {
  id: string;
  workspaceRoot: string;
  agent: string;
  model: string;
  status: SessionStatus;
  messages: StoredMessage[];
};

export class MemorySessionStore {
  #sessions = new Map<string, StoredSession>();

  create(input: CreateSessionRequest): StoredSession {
    const session: StoredSession = {
      id: createId("sess"),
      workspaceRoot: input.workspaceRoot,
      agent: input.agent,
      model: input.model,
      status: "idle",
      messages: [],
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(id: string): StoredSession | undefined {
    return this.#sessions.get(id);
  }

  update(
    id: string,
    patch: Partial<Pick<StoredSession, "status" | "messages">>,
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
