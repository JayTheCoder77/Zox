import { estimateTokens } from "./estimate.ts";

export const PRUNE_PROTECT_MIN_TOKENS = 40_000;
export const PRUNE_MIN_RECLAIM = 20_000;
export const DEFAULT_PROTECTED_TOOLS = ["skill", "todowrite"] as const;

export type PruneOptions = {
  enabled: boolean;
  protectMinTokens?: number;
  minReclaim?: number;
  protectedTools?: string[];
  estimate?: (text: string) => number;
};

export function pruneToolBodies<
  T extends { role: string; content: string; name?: string },
>(messages: T[], opts: PruneOptions): T[] {
  if (!opts.enabled) return messages;
  const estimate = opts.estimate ?? estimateTokens;
  const protectMin = opts.protectMinTokens ?? PRUNE_PROTECT_MIN_TOKENS;
  const minReclaim = opts.minReclaim ?? PRUNE_MIN_RECLAIM;
  const protectedNames = new Set([
    ...DEFAULT_PROTECTED_TOOLS,
    ...(opts.protectedTools ?? []),
  ]);

  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role !== "tool") continue;
    if (message.name && protectedNames.has(message.name)) continue;
    toolIndexes.push(i);
  }

  let kept = 0;
  const pruneSet = new Set<number>();
  for (let i = toolIndexes.length - 1; i >= 0; i--) {
    const idx = toolIndexes[i];
    if (idx === undefined) continue;
    const message = messages[idx];
    if (!message) continue;
    const tokens = estimate(message.content);
    if (kept < protectMin) {
      kept += tokens;
      continue;
    }
    pruneSet.add(idx);
  }

  let reclaimable = 0;
  for (const idx of pruneSet) {
    const message = messages[idx];
    if (message) reclaimable += estimate(message.content);
  }
  if (reclaimable < minReclaim) return messages;

  return messages.map((message, index) =>
    pruneSet.has(index) ? { ...message, content: "[pruned]" } : message,
  );
}
