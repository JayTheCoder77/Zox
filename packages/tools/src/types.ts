import { truncateUtf8 } from "@zox/sandbox";

export type ToolResult = {
  ok: boolean;
  content: string;
  truncated: boolean;
  denied?: boolean;
  denyReason?: string;
};

export type ToolContext = {
  sandboxRoot: string;
  maxToolOutputChars: number;
  session: { id: string; workspaceRoot: string; agent: string };
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
  const result = truncateUtf8(
    withinCharacterLimit,
    Buffer.byteLength(withinCharacterLimit),
  );
  return {
    content: result.text,
    truncated: characters.length > maxChars || result.truncated,
  };
}

export function toolError(content: string): ToolResult {
  return { ok: false, content, truncated: false };
}

export function toolDenied(reason: string): ToolResult {
  return {
    ok: false,
    content: reason,
    truncated: false,
    denied: true,
    denyReason: reason,
  };
}
