import { truncateUtf8 } from "@zox/sandbox";

export type ToolResult = {
  ok: boolean;
  content: string;
  truncated: boolean;
  denied?: boolean;
  denyReason?: string;
};

export type RunSubagentParent = {
  id: string;
  workspaceRoot: string;
  sandboxRoot: string;
  sandboxMode: "host" | "worktree" | "container" | "remote";
  planJson: import("@zox/memory").PlanItem[] | null;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  agent: string;
  status: string;
  messages: unknown[];
  activeSkills?: { name: string; body: string; path?: string }[];
  lastTraceId?: string;
  windowWarned?: boolean;
  priorStateMarkdown?: string;
  softPreCompactPending?: boolean;
  compactions?: unknown[];
  systemNotes?: string[];
  createdAt?: number;
};

export type RunSubagent = (input: {
  parent: RunSubagentParent;
  prompt: string;
  agent: "build" | "plan";
}) => Promise<{ ok: boolean; text: string }>;

export type ToolContext = {
  sandboxRoot: string;
  maxToolOutputChars: number;
  session: {
    id: string;
    workspaceRoot: string;
    agent: string;
    sandboxMode?: "host" | "worktree" | "container" | "remote";
  };
  remoteExec?: import("@zox/sandbox").SandboxAdapter["exec"];
  sandboxEnvAllowlist?: string[];
  sandboxAllowHosts?: string[];
  parentSession?: RunSubagentParent;
  runSubagent?: RunSubagent;
  loadPaths?: string[];
  allowedHosts?: string[];
  webfetchMaxBytes?: number;
  fetch?: typeof globalThis.fetch;
  activateSkill?: (skill: { name: string; body: string; path: string }) => void;
  memoryDb?: import("bun:sqlite").Database;
  onFileMutate?: (path: string) => Promise<void>;
  afterFileMutate?: (path: string) => Promise<string | undefined>;
};

export type ZoxTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
};

export function toolContent(
  content: string,
  maxChars: number,
): Pick<ToolResult, "content" | "truncated"> {
  const characters = Array.from(content);
  const withinCharacterLimit = characters.slice(0, maxChars).join("");
  const result = truncateUtf8(withinCharacterLimit, maxChars);
  return {
    content: result.text,
    truncated: characters.length > maxChars || result.truncated,
  };
}

export function toolError(content: string, maxChars: number): ToolResult {
  return { ok: false, ...toolContent(content, maxChars) };
}

export function toolDenied(reason: string, maxChars: number): ToolResult {
  return {
    ok: false,
    ...toolContent(reason, maxChars),
    denied: true,
    denyReason: reason,
  };
}
