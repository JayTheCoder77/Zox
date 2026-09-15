#!/usr/bin/env bun

type HookPayload = {
  sandboxRoot?: unknown;
  session?: { workspaceRoot?: unknown };
  tool?: {
    name?: unknown;
    arguments?: Record<string, unknown>;
  };
};

const raw = await Bun.stdin.text();
const input = (raw.trim() ? JSON.parse(raw) : {}) as HookPayload;
const tool = input.tool ?? {};
const name = typeof tool.name === "string" ? tool.name : "";
const args = tool.arguments ?? {};
const command = typeof args.command === "string" ? args.command : "";
const sandboxRoot =
  typeof input.sandboxRoot === "string"
    ? input.sandboxRoot
    : typeof args.sandboxRoot === "string"
      ? args.sandboxRoot
      : undefined;

function allow(): never {
  process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
  process.exit(0);
}

function deny(reason: string): never {
  process.stdout.write(`${JSON.stringify({ decision: "deny", reason })}\n`);
  process.exit(0);
}

if (name !== "bash") allow();

if (/\brm\s+-[A-Za-z]*r[A-Za-z]*f\b|\brm\s+-[A-Za-z]*f[A-Za-z]*r\b/.test(command)) {
  deny("destructive rm -rf");
}

if (sandboxRoot) {
  const { resolve, relative, isAbsolute } = await import("node:path");
  const root = resolve(sandboxRoot);
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (const token of tokens) {
    const unquoted = token.replace(/^['"]|['"]$/g, "");
    if (
      unquoted === "rm" ||
      unquoted.startsWith("-") ||
      unquoted.includes("=") ||
      (!unquoted.includes("/") && !unquoted.startsWith("~") && !isAbsolute(unquoted))
    ) {
      continue;
    }
    const expanded = unquoted.startsWith("~")
      ? unquoted.replace(/^~/, process.env.HOME ?? "")
      : unquoted;
    const abs = resolve(root, expanded);
    const rel = relative(root, abs);
    if (rel.startsWith("..")) deny(`path outside sandboxRoot: ${unquoted}`);
  }
}

allow();
