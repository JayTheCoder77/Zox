import type { ToolExecutionResult } from "./types.ts";

export interface SandboxAdapter {
  readonly mode: "host" | "worktree" | "container" | "remote";
  exec(opts: {
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    maxOutputBytes: number;
  }): Promise<ToolExecutionResult>;
}
