import {
  sessionExportSchema,
  type SessionExport,
} from "@zox/contracts";
import type { StoredSession } from "@zox/core";
import { redactSecrets } from "./redact.ts";

export async function exportSession(opts: {
  session: StoredSession;
  includeMemory?: boolean;
  readMemory?: () => Promise<string[]>;
}): Promise<SessionExport> {
  const memory =
    opts.includeMemory === true
      ? (await (opts.readMemory?.() ?? Promise.resolve([]))).map(redactSecrets)
      : undefined;

  return sessionExportSchema.parse({
    version: 1,
    session: {
      id: opts.session.id,
      agent: opts.session.agent,
      model: opts.session.model,
      status: opts.session.status,
      createdAt: opts.session.createdAt,
    },
    messages: opts.session.messages.map((message) => ({
      role: message.role,
      content: redactSecrets(message.content),
      name: message.name,
    })),
    usage: {
      inputTokens: opts.session.usage.inputTokens,
      outputTokens: opts.session.usage.outputTokens,
    },
    memory,
  });
}
