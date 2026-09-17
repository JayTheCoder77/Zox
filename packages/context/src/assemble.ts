import type { CompactResult } from "./compact.ts";
import { type PruneOptions, pruneToolBodies } from "./prune.ts";

export type ProviderMessage = {
  id: string;
  role: string;
  content: string;
  meta?: { summary?: boolean };
};

export function assembleProviderMessages<T extends ProviderMessage>(session: {
  messages: T[];
  compactions?: CompactResult[];
  familyPrompt?: string;
  agentOverlay?: string;
  environment?: string;
  projectInstructions?: string;
  skillsCatalog?: string;
  skillBodies?: string[];
  priorStateMarkdown?: string;
  systemNotes?: string[];
  prune?: PruneOptions;
}): T[] {
  const assembled = pruneToolBodies(
    assembleHistory(session),
    session.prune ?? { enabled: false },
  );
  const prefixes: T[] = [];
  pushSystem(prefixes, "prompt:family", session.familyPrompt);
  pushSystem(prefixes, "prompt:agent", session.agentOverlay);
  pushSystem(prefixes, "prompt:env", session.environment);
  pushSystem(prefixes, "prompt:project", session.projectInstructions);
  if (session.systemNotes?.length) {
    prefixes.push({
      id: "hook:notes",
      role: "system",
      content: session.systemNotes.join("\n\n"),
    } as T);
  }
  if (session.priorStateMarkdown?.trim()) {
    prefixes.push({
      id: "prior-state",
      role: "system",
      content: session.priorStateMarkdown,
    } as T);
  }
  if (session.skillsCatalog?.trim()) {
    prefixes.push({
      id: "skill:catalog",
      role: "system",
      content: session.skillsCatalog,
    } as T);
  }
  if (session.skillBodies?.length) {
    prefixes.push({
      id: "skill:active",
      role: "system",
      content: session.skillBodies.join("\n\n"),
    } as T);
  }
  if (prefixes.length === 0) return assembled;
  return [...prefixes, ...assembled];
}

function pushSystem<T extends ProviderMessage>(
  prefixes: T[],
  id: string,
  content?: string,
): void {
  if (!content?.trim()) return;
  prefixes.push({ id, role: "system", content } as T);
}

function assembleHistory<T extends ProviderMessage>(session: {
  messages: T[];
  compactions?: CompactResult[];
}): T[] {
  const compactions = session.compactions ?? [];
  if (compactions.length === 0) {
    return [...session.messages];
  }

  const skipped = skippedIds(session.messages, compactions);
  const summaryAt = new Map(
    compactions.map((c) => [c.fromMessageId, c.summary]),
  );

  const out: T[] = [];
  for (const message of session.messages) {
    if (skipped.has(message.id)) {
      const summary = summaryAt.get(message.id);
      if (summary !== undefined) {
        out.push({
          ...message,
          id: `compact:${message.id}`,
          role: "assistant",
          content: summary,
          meta: { summary: true },
        });
      }
      continue;
    }
    out.push(message);
  }
  return out;
}

function skippedIds(
  messages: ProviderMessage[],
  compactions: CompactResult[],
): Set<string> {
  const skipped = new Set<string>();
  for (const compact of compactions) {
    let inRange = false;
    for (const message of messages) {
      if (message.id === compact.fromMessageId) inRange = true;
      if (inRange) skipped.add(message.id);
      if (message.id === compact.toMessageId) break;
    }
  }
  return skipped;
}
