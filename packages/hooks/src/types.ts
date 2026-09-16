export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PreCompact"
  | "PostCompact"
  | "Stop"
  | "SessionEnd"
  | "InstructionsLoaded";

export type HookInput = {
  event: HookEvent;
  session: { id: string; workspaceRoot: string };
  tool?: { name: string; arguments: Record<string, unknown> };
  prompt?: string;
  context?: { estimatedTokens?: number };
  matcher?: string;
  skills?: Array<{ name: string; path?: string }>;
};

export type HookOutput = {
  decision: "allow" | "deny" | "ask";
  reason?: string;
  message?: string;
  updatedInput?: Record<string, unknown>;
};

export type HookEntry = {
  matcher: string;
  type: "command";
  command: string;
  timeoutMs?: number;
};

export type HooksFile = {
  zoxHooksVersion: 1;
  hooks: Partial<Record<HookEvent, HookEntry[]>>;
  trusted?: boolean;
};

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "Stop",
  "SessionEnd",
  "InstructionsLoaded",
] as const satisfies readonly HookEvent[];
