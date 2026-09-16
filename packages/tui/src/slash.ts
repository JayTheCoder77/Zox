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
  "remember",
  "exit",
] as const;

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

export function slashCompletions(prefix: string): string[] {
  const body = prefix.startsWith("/") ? prefix.slice(1) : prefix;
  return SLASH_NAMES.filter((name) => name.startsWith(body)).map(
    (name) => `/${name}`,
  );
}

export function cycleSlashCompletion(
  input: string,
  currentIndex: number,
): { next: string; index: number } {
  const matches = slashCompletions(input.split(/\s/)[0] ?? input);
  if (matches.length === 0) {
    return { next: input, index: 0 };
  }
  const nextIndex = (currentIndex + 1) % matches.length;
  const rest = input.includes(" ") ? input.slice(input.indexOf(" ")) : "";
  return { next: `${matches[nextIndex]}${rest}`, index: nextIndex };
}
