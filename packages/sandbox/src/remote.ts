import type { SandboxAdapter } from "./adapter.ts";

export function createRemoteAdapter(opts: {
  exec: SandboxAdapter["exec"];
}): SandboxAdapter {
  return {
    mode: "remote",
    exec: opts.exec,
  };
}
