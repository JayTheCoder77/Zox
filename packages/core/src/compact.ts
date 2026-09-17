import { type CompactResult, compactSession } from "@zox/context";
import type { ZoxEvent } from "@zox/contracts";
import type { HookRunner } from "./loop.ts";
import type { StoredSession } from "./store.ts";

export type SessionSummarizer = (prompt: string) => Promise<string>;

export function appendPriorStateMessage(
  session: StoredSession,
  message?: string,
): void {
  const trimmed = message?.trim();
  if (!trimmed) return;
  session.priorStateMarkdown = [session.priorStateMarkdown, trimmed]
    .filter(Boolean)
    .join("\n\n");
}

export async function* compactSessionTurn(opts: {
  session: StoredSession;
  summarize: SessionSummarizer;
  hooks?: HookRunner;
  kind?: "manual" | "auto";
  estimatedTokens?: number;
}): AsyncIterable<ZoxEvent> {
  const { session } = opts;
  const kind = opts.kind ?? "manual";
  session.status = "compacting";
  yield {
    type: "session.status",
    sessionId: session.id,
    status: "compacting",
  };

  if (opts.hooks) {
    await opts.hooks.run("PreCompact", {
      session: {
        id: session.id,
        workspaceRoot: session.workspaceRoot,
      },
      matcher: kind,
      context: { estimatedTokens: opts.estimatedTokens },
    });
  }

  const { compact } = await compactSession({
    messages: session.messages,
    planJson: session.planJson,
    activeSkillNames: session.activeSkills?.map((s) => s.name),
    summarize: opts.summarize,
  });

  if (!session.compactions) session.compactions = [];
  session.compactions.push(compact);
  session.priorStateMarkdown = compact.summary;
  const skillNames = (session.activeSkills ?? [])
    .map((skill) => skill.name)
    .filter(Boolean);
  if (skillNames.length > 0) {
    const line = `Active skills: ${skillNames.join(", ")}`;
    if (!session.priorStateMarkdown.includes(line)) {
      session.priorStateMarkdown = [session.priorStateMarkdown, line]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  if (opts.hooks) {
    const compactStart = await opts.hooks.run("SessionStart", {
      matcher: "compact",
      session: {
        id: session.id,
        workspaceRoot: session.workspaceRoot,
      },
    });
    appendPriorStateMessage(session, compactStart.message);

    await opts.hooks.run("PostCompact", {
      session: {
        id: session.id,
        workspaceRoot: session.workspaceRoot,
      },
    });
  }

  yield {
    type: "context.compacted",
    sessionId: session.id,
    fromMessageId: compact.fromMessageId,
    toMessageId: compact.toMessageId,
  };

  session.softPreCompactPending = false;
  session.status = "idle";
  yield {
    type: "session.status",
    sessionId: session.id,
    status: "idle",
  };
}

export type { CompactResult };
