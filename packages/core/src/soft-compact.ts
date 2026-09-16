import { appendPriorStateMessage } from "./compact.ts";
import type { HookRunner } from "./loop.ts";
import type { StoredSession } from "./store.ts";

export async function runSoftPreCompact(opts: {
  session: StoredSession;
  hooks?: HookRunner;
  estimatedTokens: number;
}): Promise<void> {
  if (!opts.hooks) return;

  const sessionPayload = {
    id: opts.session.id,
    workspaceRoot: opts.session.workspaceRoot,
  };

  const preCompact = await opts.hooks.run("PreCompact", {
    session: sessionPayload,
    matcher: "auto",
    context: { estimatedTokens: opts.estimatedTokens },
  });
  appendPriorStateMessage(opts.session, preCompact.message);

  const compactStart = await opts.hooks.run("SessionStart", {
    matcher: "compact",
    session: sessionPayload,
  });
  appendPriorStateMessage(opts.session, compactStart.message);
}
