import type { PermissionRuleset } from "@zox/contracts";

export type AgentProfile = {
  name: "build" | "plan" | string;
  tools: string[];
  ruleset: PermissionRuleset;
};

const BUILD_TOOLS = [
  "read",
  "grep",
  "glob",
  "ls",
  "skill",
  "todowrite",
  "write",
  "edit",
  "bash",
  "webfetch",
  "memory_search",
  "memory_write",
  "mcp_*",
];

export function toolMatchesProfile(
  profileTools: readonly string[],
  name: string,
): boolean {
  return profileTools.some((entry) =>
    entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : entry === name,
  );
}

const PLAN_TOOLS = [
  "read",
  "grep",
  "glob",
  "ls",
  "skill",
  "todowrite",
  "memory_search",
  "memory_write",
];

function ruleset(
  allowedTools: readonly string[],
  deniedTools: readonly string[],
): PermissionRuleset {
  return Object.fromEntries([
    ...allowedTools.map((tool) => [tool, { default: "allow" as const }]),
    ...deniedTools.map((tool) => [tool, { default: "deny" as const }]),
  ]);
}

const PROFILES: Record<"build" | "plan", AgentProfile> = {
  build: {
    name: "build",
    tools: BUILD_TOOLS,
    ruleset: ruleset(
      [
        "read",
        "grep",
        "glob",
        "ls",
        "skill",
        "todowrite",
        "memory_search",
        "mcp_*",
      ],
      [],
    ),
  },
  plan: {
    name: "plan",
    tools: PLAN_TOOLS,
    ruleset: ruleset(PLAN_TOOLS, ["write", "edit", "bash"]),
  },
};

for (const tool of ["write", "edit", "bash", "webfetch", "memory_write"]) {
  PROFILES.build.ruleset[tool] = { default: "ask" };
}
PROFILES.plan.ruleset.memory_search = { default: "allow" };
PROFILES.plan.ruleset.memory_write = { default: "ask" };

export function getAgentProfile(name: string): AgentProfile {
  if (name !== "build" && name !== "plan") {
    throw new Error(`Unknown agent profile: ${name}`);
  }
  return PROFILES[name];
}
