import { readFileSync } from "node:fs";
import { matcherHits } from "./match.ts";
import type {
  HookEntry,
  HookEvent,
  HookInput,
  HookOutput,
  HooksFile,
} from "./types.ts";
import { HOOK_EVENTS } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 5000;
const CANNOT_DENY = new Set<HookEvent>([
  "SessionStart",
  "PostToolUse",
  "SessionEnd",
  "InstructionsLoaded",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUseFailure",
  "PostToolBatch",
  "SubagentStart",
  "SubagentStop",
]);

export type RunHooksOpts = {
  files: HooksFile[];
  event: HookEvent;
  input: HookInput;
  matchValue: string;
  trusted?: boolean;
  cwd: string;
  onError?: "warn" | "deny";
  onDuration?: (event: HookEvent, seconds: number) => void;
};

export function loadHooksFile(path: string): HooksFile {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || parsed.zoxHooksVersion !== 1) {
    throw new Error("Invalid hooks file: zoxHooksVersion must be 1");
  }
  const hooksRaw = parsed.hooks;
  if (
    hooksRaw !== undefined &&
    (!isRecord(hooksRaw) || Array.isArray(hooksRaw))
  ) {
    throw new Error("Invalid hooks file: hooks must be an object");
  }
  const hooks: HooksFile["hooks"] = {};
  if (isRecord(hooksRaw)) {
    for (const event of HOOK_EVENTS) {
      const entries = hooksRaw[event];
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) {
        throw new Error(`Invalid hooks file: ${event} must be an array`);
      }
      hooks[event] = entries.map((entry) => parseEntry(entry, event));
    }
  }
  return { zoxHooksVersion: 1, hooks };
}

export async function runHooks(opts: RunHooksOpts): Promise<HookOutput> {
  let output: HookOutput = { decision: "allow" };
  const onError = opts.onError ?? "warn";

  for (const file of opts.files) {
    const fileTrusted = file.trusted ?? opts.trusted ?? true;
    if (!fileTrusted) continue;
    const entries = file.hooks[opts.event] ?? [];
    for (const entry of entries) {
      if (!matcherHits(entry.matcher, opts.matchValue)) continue;
      const hookStarted = performance.now();
      const next =
        entry.type === "http"
          ? await runHttpHook(entry, opts.input, onError)
          : await runCommandHook(entry, opts.input, opts.cwd, onError);
      opts.onDuration?.(opts.event, (performance.now() - hookStarted) / 1000);
      const normalized = normalizeDecision(opts.event, next);
      if (normalized.updatedInput) {
        output = { ...normalized, updatedInput: normalized.updatedInput };
      } else {
        output = { ...output, ...normalized };
      }
      if (normalized.decision === "deny" || normalized.decision === "ask") {
        return normalized;
      }
    }
  }

  return output;
}

export function createHookRunner(opts: {
  files: HooksFile[];
  trusted?: boolean;
  cwd: string;
  onError?: "warn" | "deny";
  onDuration?: (event: HookEvent, seconds: number) => void;
}): {
  run(event: string, payload: unknown): Promise<HookOutput>;
} {
  return {
    async run(event, payload) {
      const hookEvent = asHookEvent(event);
      const input = hookInputFrom(hookEvent, payload);
      return runHooks({
        files: opts.files,
        event: hookEvent,
        input,
        matchValue: matchValueFrom(input),
        trusted: opts.trusted,
        cwd: opts.cwd,
        onError: opts.onError,
        onDuration: opts.onDuration,
      });
    },
  };
}

function parseEntry(entry: unknown, event: HookEvent): HookEntry {
  if (!isRecord(entry)) {
    throw new Error(`Invalid hook entry for ${event}`);
  }
  const matcher = typeof entry.matcher === "string" ? entry.matcher : "*";
  const timeoutMs =
    typeof entry.timeoutMs === "number" ? entry.timeoutMs : undefined;
  if (entry.type === "http") {
    const parsed: HookEntry = { matcher, type: "http", timeoutMs };
    if (typeof entry.url === "string") parsed.url = entry.url;
    const headers = parseHeaders(entry.headers);
    if (headers) parsed.headers = headers;
    return parsed;
  }
  if (entry.type !== "command" || typeof entry.command !== "string") {
    throw new Error(`Invalid hook entry for ${event}: type must be command`);
  }
  return { matcher, type: "command", command: entry.command, timeoutMs };
}

async function runHttpHook(
  entry: HookEntry,
  input: HookInput,
  onError: "warn" | "deny",
): Promise<HookOutput> {
  const url = entry.url;
  if (!url) return failHook("http hook missing url", onError);
  const timeoutMs = entry.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(entry.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const text = await res.text();
    const parsed = parseOutput(text);
    if (!parsed) {
      return failHook("hook response was not valid HookOutput JSON", onError);
    }
    return parsed;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "http hook request failed";
    return failHook(reason, onError);
  } finally {
    clearTimeout(timer);
  }
}

async function runCommandHook(
  entry: HookEntry,
  input: HookInput,
  cwd: string,
  onError: "warn" | "deny",
): Promise<HookOutput> {
  if (!entry.command) return failHook("command hook missing command", onError);
  const timeoutMs = entry.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const proc = Bun.spawn(["/bin/sh", "-c", entry.command], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();

  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    sleep(timeoutMs).then(() => true),
  ]);
  if (timedOut) {
    proc.kill();
    await proc.exited.catch(() => undefined);
    return failHook(`hook timed out after ${timeoutMs}ms`, onError);
  }

  const exitCode = proc.exitCode ?? (await proc.exited);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode === 2) {
    return { decision: "deny" };
  }
  if (exitCode !== 0) {
    if (stderr.trim()) console.warn(stderr.trim());
    return failHook(`hook exited ${exitCode}`, onError);
  }

  const parsed = parseOutput(stdout);
  if (!parsed) {
    return failHook("hook stdout was not valid HookOutput JSON", onError);
  }
  return parsed;
}

function parseOutput(stdout: string): HookOutput | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return { decision: "allow" };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) return undefined;
    const decision = parsed.decision;
    if (decision !== "allow" && decision !== "deny" && decision !== "ask") {
      return undefined;
    }
    const out: HookOutput = { decision };
    if (typeof parsed.reason === "string") out.reason = parsed.reason;
    if (typeof parsed.message === "string") out.message = parsed.message;
    if (isRecord(parsed.updatedInput)) {
      out.updatedInput = parsed.updatedInput;
    }
    return out;
  } catch {
    return undefined;
  }
}

function failHook(reason: string, onError: "warn" | "deny"): HookOutput {
  if (onError === "deny") return { decision: "deny", reason };
  console.warn(reason);
  return { decision: "allow" };
}

function normalizeDecision(event: HookEvent, output: HookOutput): HookOutput {
  if (output.decision === "deny" && CANNOT_DENY.has(event)) {
    return { ...output, decision: "allow" };
  }
  return output;
}

function asHookEvent(event: string): HookEvent {
  if ((HOOK_EVENTS as readonly string[]).includes(event)) {
    return event as HookEvent;
  }
  throw new Error(`Unknown hook event: ${event}`);
}

function hookInputFrom(event: HookEvent, payload: unknown): HookInput {
  const record = isRecord(payload) ? payload : {};
  const sessionRaw = isRecord(record.session) ? record.session : {};
  const input: HookInput = {
    event,
    session: {
      id: typeof sessionRaw.id === "string" ? sessionRaw.id : "",
      workspaceRoot:
        typeof sessionRaw.workspaceRoot === "string"
          ? sessionRaw.workspaceRoot
          : "",
    },
  };
  if (isRecord(record.tool) && typeof record.tool.name === "string") {
    input.tool = {
      name: record.tool.name,
      arguments: isRecord(record.tool.arguments) ? record.tool.arguments : {},
    };
  }
  if (typeof record.prompt === "string") input.prompt = record.prompt;
  if (isRecord(record.context)) {
    const estimated = record.context.estimatedTokens;
    input.context = {
      estimatedTokens: typeof estimated === "number" ? estimated : undefined,
    };
  }
  if (typeof record.matcher === "string") input.matcher = record.matcher;
  if (Array.isArray(record.skills)) {
    input.skills = record.skills.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.name !== "string") return [];
      return [
        {
          name: entry.name,
          path: typeof entry.path === "string" ? entry.path : undefined,
        },
      ];
    });
  }
  return input;
}

function matchValueFrom(input: HookInput): string {
  if (input.matcher) return input.matcher;
  if (input.tool?.name) return input.tool.name;
  return input.event;
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value)) {
    if (typeof header === "string") headers[key] = header;
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
