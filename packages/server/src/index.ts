import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  adaptersFromConfig,
  loadZoxConfig,
  resolveConfigEnv,
  resolveMcpServerEnv,
} from "@zox/config";
import {
  createHookRunner,
  defaultTrustStorePath,
  type HooksFile,
  loadHooksFile,
} from "@zox/hooks";
import { McpPool } from "@zox/mcp";
import { createObservability } from "@zox/observability";
import { createProviderRouter } from "@zox/providers";
import { DEFAULT_SANDBOX_CONFIG } from "@zox/sandbox";
import { SqliteSessionStore } from "@zox/session";
import { createBuiltinTools, ToolRegistry } from "@zox/tools";
import { createApp } from "./app.ts";
import { sessionWebSocketHandlers } from "./ws.ts";

export type { AppConfig, AppRouter } from "./app.ts";
export { createApp } from "./app.ts";
export {
  type SessionWsData,
  sessionWebSocket,
  sessionWebSocketHandlers,
  type WsClientMessage,
} from "./ws.ts";

export async function listen(opts?: {
  port?: number;
  hostname?: string;
  token?: string;
  trustStorePath?: string;
  sandboxMode?: "host" | "worktree" | "container" | "remote";
  worktreeCleanup?: "keep" | "remove";
  workspaceRoot?: string;
  budget?: { maxTurns?: number; maxUsdPerTask?: number };
}): Promise<{ port: number; stop(): void }> {
  const fromEnv = process.env.ZOXX_SERVER_TOKEN;
  const token = opts?.token ?? fromEnv ?? crypto.randomUUID();
  if (opts?.token ?? fromEnv) {
    console.error("ZOXX_SERVER_TOKEN set");
  } else {
    console.error("ZOXX_SERVER_TOKEN generated");
  }

  const cwd = opts?.workspaceRoot ?? process.cwd();
  const zoxConfig = loadZoxConfig(cwd);
  const { adapters, providerMeta } = adaptersFromConfig(zoxConfig);
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  const observability = createObservability({
    enabled: zoxConfig.observability?.enabled,
    recordContent: zoxConfig.observability?.recordContent ?? false,
    serviceName: zoxConfig.observability?.serviceName,
    otlp: {
      endpoint: zoxConfig.observability?.otlp?.endpoint,
      headers: resolveOtlpHeaders(zoxConfig.observability?.otlp?.headers),
    },
  });
  const mcp = new McpPool();
  await registerMcpFromConfig(mcp, tools, zoxConfig);

  const metricsEnabled = process.env.ZOXX_OBSERVABILITY !== "0";
  const autoSummarize =
    zoxConfig.memory?.autoSummarize ??
    !(
      process.env.ZOXX_MEMORY_AUTO_SUMMARIZE === "0" ||
      process.env.ZOXX_MEMORY_AUTO_SUMMARIZE === "false"
    );

  const projectTrusted = isProjectTrustedSync(cwd, opts?.trustStorePath);
  const hookFiles = loadHookFiles(cwd, projectTrusted);
  const hooks = createHookRunner({
    files: hookFiles,
    cwd,
    onDuration: (event, seconds) => {
      observability.recordHookDuration(event, seconds);
    },
  });

  const sandboxMode =
    opts?.sandboxMode ?? zoxConfig.sandbox?.mode ?? DEFAULT_SANDBOX_CONFIG.mode;

  const app = createApp({
    token,
    store: new SqliteSessionStore({ workspaceRoot: cwd }),
    router: createProviderRouter({ adapters }),
    tools,
    mcp,
    hooks,
    observability,
    adapterIds: adapters.map((adapter) => adapter.id),
    workspaceRoot: cwd,
    config: {
      model: zoxConfig.model ?? "mock/echo",
      agent: zoxConfig.agent ?? "build",
      providers: providerMeta,
      sandbox: {
        mode: sandboxMode,
        envAllowlist: zoxConfig.sandbox?.envAllowlist,
        network: zoxConfig.sandbox?.network,
      },
      observability: zoxConfig.observability ?? { metrics: metricsEnabled },
      memory: {
        autoSummarize,
        summarizeModel: zoxConfig.memory?.summarizeModel,
        startupInjectCount: zoxConfig.memory?.startupInjectCount,
        rollingSummary: zoxConfig.memory?.rollingSummary,
        autoInject: zoxConfig.memory?.autoInject,
      },
      skills: zoxConfig.skills,
      tools: zoxConfig.tools,
      budget: {
        ...zoxConfig.budget,
        ...opts?.budget,
      },
      context: {
        ...zoxConfig.context,
        windowTokens: zoxConfig.context?.windowTokens,
      },
      instructions: zoxConfig.instructions,
      hooks: hookFiles[0],
      worktreeCleanup:
        opts?.worktreeCleanup ??
        zoxConfig.sandbox?.worktree?.cleanup ??
        DEFAULT_SANDBOX_CONFIG.worktree.cleanup,
    },
  });
  const hostname = opts?.hostname ?? "127.0.0.1";
  const port = opts?.port ?? 8787;
  const server = Bun.serve({
    hostname,
    port,
    fetch(req, bunServer) {
      const url = new URL(req.url);
      if (
        req.method === "GET" &&
        /^\/sessions\/[^/]+\/ws$/.test(url.pathname)
      ) {
        bunServer.timeout(req, 0);
        const res = app.handleWebSocket(req, bunServer);
        if (res === undefined) return;
        return res;
      }
      if (
        req.method === "GET" &&
        /^\/sessions\/[^/]+\/events$/.test(url.pathname)
      ) {
        // SSE may sit idle until the model emits; Bun's default 10s idleTimeout
        // resets the socket and breaks the CLI/TUI client mid-turn.
        bunServer.timeout(req, 0);
      }
      return app.fetch(req, bunServer);
    },
    websocket: sessionWebSocketHandlers,
  });
  return {
    port: server.port ?? port,
    stop() {
      server.stop();
      void observability.shutdown();
    },
  };
}

function resolveOtlpHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = resolveConfigEnv(value);
  }
  return out;
}

async function registerMcpFromConfig(
  mcp: McpPool,
  tools: ToolRegistry,
  zoxConfig: ReturnType<typeof loadZoxConfig>,
): Promise<void> {
  for (const [name, spec] of Object.entries(zoxConfig.mcp?.servers ?? {})) {
    await mcp.add(name, {
      command: spec.command,
      args: spec.args,
      env: resolveMcpServerEnv(spec.env),
    });
  }
  for (const tool of mcp.asZoxTools()) {
    tools.register(tool);
  }
}

function loadHookFiles(cwd: string, projectTrusted: boolean): HooksFile[] {
  const files: HooksFile[] = [];
  const projectHooks = join(cwd, ".zox", "hooks.json");
  if (existsSync(projectHooks)) {
    files.push({ ...loadHooksFile(projectHooks), trusted: projectTrusted });
  }
  const userHooks = join(homedir(), ".config", "zox", "hooks.json");
  if (existsSync(userHooks)) {
    files.push({ ...loadHooksFile(userHooks), trusted: true });
  }
  return files;
}

function isProjectTrustedSync(
  projectRoot: string,
  storePath = defaultTrustStorePath(),
): boolean {
  let store: Record<string, string>;
  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    store = parsed as Record<string, string>;
  } catch {
    return false;
  }

  const target = resolve(projectRoot);
  const targetReal = safeRealpath(target);
  for (const [key, value] of Object.entries(store)) {
    const keyReal = safeRealpath(key);
    if (
      key === target ||
      keyReal === targetReal ||
      key === targetReal ||
      keyReal === target
    ) {
      const expected = createHash("sha256").update(key).digest("hex");
      return value === expected;
    }
  }
  return false;
}

function safeRealpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
