import type { PermissionDecision, PermissionRuleset } from "@zox/contracts";

export type { PermissionDecision, PermissionRuleset } from "@zox/contracts";

function matches(entry: string, value: string): boolean {
  if (entry.endsWith("*")) {
    return value.startsWith(entry.slice(0, -1));
  }
  return value === entry;
}

export function evaluatePermission(
  ruleset: PermissionRuleset,
  toolName: string,
  commandOrPath?: string,
): PermissionDecision {
  const rules = ruleset[toolName];
  if (!rules) {
    return "deny";
  }

  const value = commandOrPath ?? toolName;
  if (rules.deny?.some((entry) => matches(entry, value))) {
    return "deny";
  }
  if (rules.allow?.some((entry) => matches(entry, value))) {
    return "allow";
  }
  return rules.default ?? "ask";
}
