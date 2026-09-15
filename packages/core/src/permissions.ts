import type { PermissionDecision, PermissionRuleset } from "@zox/contracts";

export type { PermissionDecision, PermissionRuleset } from "@zox/contracts";

const MCP_ASK_RE = /write|create|delete|update/i;

function matches(entry: string, value: string): boolean {
  if (entry.endsWith("*")) {
    return value.startsWith(entry.slice(0, -1));
  }
  return value === entry;
}

function lookupRules(
  ruleset: PermissionRuleset,
  toolName: string,
): PermissionRuleset[string] | undefined {
  const exact = ruleset[toolName];
  if (exact) return exact;
  for (const [key, rules] of Object.entries(ruleset)) {
    if (key.endsWith("*") && toolName.startsWith(key.slice(0, -1))) {
      return rules;
    }
  }
  return undefined;
}

export function evaluatePermission(
  ruleset: PermissionRuleset,
  toolName: string,
  commandOrPath?: string,
): PermissionDecision {
  const rules = lookupRules(ruleset, toolName);
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
  if (toolName.startsWith("mcp_") && MCP_ASK_RE.test(toolName)) {
    return "ask";
  }
  return rules.default ?? "ask";
}
