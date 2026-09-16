export const SLASH_NAMES = [
  "help",
  "model",
  "agent",
  "compact",
  "context",
  "usage",
  "clear",
  "mcp",
  "skill",
  "skills",
  "cancel",
  "sandbox",
  "trace",
  "exit",
] as const;

export type SlashName = (typeof SLASH_NAMES)[number];

export type CliFlags = {
  model?: string;
  agent?: string;
  workspace?: string;
  url?: string;
  token?: string;
  noTui?: boolean;
  sandbox?: "host" | "worktree";
  port?: number;
};

export function parseSlash(
  input: string,
): { name: string; args: string[] } | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const body = trimmed.slice(1).trim();
  if (!body) return undefined;
  const parts = body.split(/\s+/);
  const name = parts[0] ?? "";
  if (!name) return undefined;
  return { name, args: parts.slice(1) };
}

export function parseArgs(argv: string[]): {
  flags: CliFlags;
  positionals: string[];
} {
  const flags: CliFlags = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--no-tui") {
      flags.noTui = true;
      continue;
    }

    if (arg === "--model" && argv[i + 1]) {
      flags.model = argv[++i];
      continue;
    }
    if (arg === "--agent" && argv[i + 1]) {
      flags.agent = argv[++i];
      continue;
    }
    if (arg === "--workspace" && argv[i + 1]) {
      flags.workspace = argv[++i];
      continue;
    }
    if (arg === "--url" && argv[i + 1]) {
      flags.url = argv[++i];
      continue;
    }
    if (arg === "--token" && argv[i + 1]) {
      flags.token = argv[++i];
      continue;
    }
    if (arg === "--port" && argv[i + 1]) {
      const port = Number(argv[++i]);
      if (!Number.isNaN(port)) flags.port = port;
      continue;
    }
    if (arg === "--sandbox" && argv[i + 1]) {
      const mode = argv[++i];
      if (mode === "host" || mode === "worktree") {
        flags.sandbox = mode;
      }
      continue;
    }

    if (arg.startsWith("--")) {
      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}
