import type { SandboxAdapter } from "./adapter.ts";
import type { ToolExecutionResult } from "./types.ts";

export function createRemoteAdapter(opts: {
  exec: SandboxAdapter["exec"];
}): SandboxAdapter {
  return {
    mode: "remote",
    exec: opts.exec,
  };
}
