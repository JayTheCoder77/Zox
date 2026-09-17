export type ToolExecutionResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  denied: boolean;
  denyReason?: string;
  durationMs: number;
};

export type SandboxConfig = {
  mode: "host" | "worktree" | "container" | "remote";
  root: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxToolOutputChars: number;
  denylist: {
    executables: string[];
    blockInterpreterOneLiners: boolean;
    interpreterFlags: string[];
  };
  worktree: {
    path: string;
    branchPrefix: string;
    cleanup: "keep" | "remove";
    requireGit: boolean;
  };
  envAllowlist?: string[];
  network?: {
    allowHosts?: string[];
  };
};
