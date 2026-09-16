export type StatusBarInput = {
  model: string;
  agent: string;
  cwd: string;
  contextEstimated: number;
  contextWindow: number;
  contextWindowKnown: boolean;
  inputTokens: number;
  outputTokens: number;
};

const MAX_SUMMARY_CHARS = 160;
const DEFAULT_CONTEXT_WINDOW = 128_000;

export function formatCompactTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1000)}k`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

export function formatStatus(input: StatusBarInput): string {
  const {
    model,
    agent,
    cwd,
    contextEstimated,
    contextWindow,
    contextWindowKnown,
    inputTokens,
    outputTokens,
  } = input;
  const window = contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW;
  const pct = Math.min(999, Math.round((contextEstimated / window) * 100));
  const windowLabel = contextWindowKnown
    ? formatCompactTokens(window)
    : `~${formatCompactTokens(window)}`;
  const ctx = `ctx ${formatCompactTokens(contextEstimated)}/${windowLabel} (${pct}%)`;
  const usage = `in ${formatCompactTokens(inputTokens)} out ${formatCompactTokens(outputTokens)}`;
  const shortCwd = cwd.length > 28 ? `…${cwd.slice(-27)}` : cwd;
  return `${model} · ${agent} · ${ctx} · ${usage} · ${shortCwd}`;
}

function truncateSummary(text: string, max = MAX_SUMMARY_CHARS): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function strArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

/** One-line description of what a tool call is doing (for transcript / REPL). */
export function toolInvocationSummary(
  name: string,
  args: Record<string, unknown> = {},
): string {
  const shortName = name.startsWith("mcp_") ? name : name;

  switch (shortName) {
    case "bash": {
      const command = strArg(args, "command");
      return command ? `bash › ${truncateSummary(command)}` : "bash";
    }
    case "read": {
      const path = strArg(args, "path");
      if (!path) return "read";
      const offset = args.offset;
      const extra =
        typeof offset === "number" && offset > 1 ? ` (line ${offset})` : "";
      return `read › ${path}${extra}`;
    }
    case "write": {
      const path = strArg(args, "path");
      return path ? `write › ${path}` : "write";
    }
    case "edit": {
      const path = strArg(args, "path");
      return path ? `edit › ${path}` : "edit";
    }
    case "grep": {
      const pattern = strArg(args, "pattern");
      const path = strArg(args, "path");
      const glob = strArg(args, "glob");
      const where = path ?? glob ?? ".";
      return pattern
        ? `grep › /${truncateSummary(pattern)}/ in ${where}`
        : "grep";
    }
    case "glob": {
      const pattern = strArg(args, "pattern");
      const path = strArg(args, "path");
      const where = path ? ` in ${path}` : "";
      return pattern ? `glob › ${pattern}${where}` : "glob";
    }
    case "ls": {
      const path = strArg(args, "path");
      return path ? `ls › ${path}` : "ls";
    }
    case "skill": {
      const skillName = strArg(args, "name");
      return skillName ? `skill › ${skillName}` : "skill";
    }
    case "todowrite":
      return "todowrite › update plan";
    default: {
      const keys = Object.keys(args);
      if (keys.length === 0) return shortName;
      const preview = truncateSummary(JSON.stringify(args));
      return `${shortName} › ${preview}`;
    }
  }
}

export function foldTool(
  name: string,
  ok: boolean | undefined,
  args?: Record<string, unknown>,
): string {
  const summary = toolInvocationSummary(name, args ?? {});
  if (ok === undefined) return summary;
  return `${summary} — ${ok ? "ok" : "denied"}`;
}

/** Extra detail when the user expands a tool row in the TUI. */
export function formatToolExpanded(
  name: string,
  args: Record<string, unknown>,
): string {
  const command = strArg(args, "command");
  if (name === "bash" && command) {
    return command;
  }
  return JSON.stringify(args, null, 2);
}
