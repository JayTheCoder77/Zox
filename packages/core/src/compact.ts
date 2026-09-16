import { type CompactResult, compactSession } from "@zox/context";
import type { ZoxEvent } from "@zox/contracts";
import type { HookRunner } from "./loop.ts";
import type { StoredSession } from "./store.ts";

export type SessionSummarizer = (prompt: string) => Promise<string>;

export async function* compactSessionTurn(opts: {
  session: StoredSession;
  summarize: SessionSummarizer;
  hooks?: HookRunner;
}): AsyncIterable<ZoxEvent> {
  const { session } = opts;
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

  if (opts.hooks) {
    const compactStart = await opts.hooks.run("SessionStart", {
      matcher: "compact",
      session: {
        id: session.id,
        workspaceRoot: session.workspaceRoot,
      },
    });
    if (compactStart.message?.trim()) {
      session.priorStateMarkdown = [
        session.priorStateMarkdown,
        compactStart.message.trim(),
      ]
        .filter(Boolean)
        .join("\n\n");
    }

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

  session.status = "idle";
  yield {
    type: "session.status",
    sessionId: session.id,
    status: "idle",
  };
}

export type { CompactResult };
