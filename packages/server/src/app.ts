import { existsSync } from "node:fs";
import { estimateSession } from "@zox/context";
import {
  createSessionRequestSchema,
  mutateSessionSkillsRequestSchema,
  sendMessageRequestSchema,
  writeMemoryRequestSchema,
  type ZoxEvent,
} from "@zox/contracts";
import {
  compactSessionTurn,
  createId,
  type HookRunner,
  type PermissionResponder,
  runTurn,
  type SessionStore,
  type SessionSummarizer,
  type StoredSession,
} from "@zox/core";
import type { HooksFile } from "@zox/hooks";
import { formatDiagnostics, typescriptDiagnostics } from "@zox/lsp";
import { McpPool } from "@zox/mcp";
import {
  autoSummarize,
  loadStartupMemories,
  searchDurableMemories,
  writeDurableMemory,
} from "@zox/memory";
import type { Observability } from "@zox/observability";
import type { createProviderRouter } from "@zox/providers";
import {
  DEFAULT_SANDBOX_CONFIG,
  ensureWorktree,
  removeWorktree,
} from "@zox/sandbox";
import {
  recordFileSnapshot,
  restoreSnapshot,
  SqliteSessionStore,
} from "@zox/session";
import {
  activateSkill,
  deactivateSkill,
  discoverSkills,
  findSkill,
  type SkillDiscoveryOptions,
} from "@zox/skills";
import { createBuiltinTools, ToolRegistry } from "@zox/tools";
import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { bearerAuth } from "./auth.ts";
import { SessionEventBus } from "./bus.ts";
import { exportSession } from "./export-session.ts";
import { resolveCustomSlash } from "./slash-plugins.ts";
import { sessionWebSocket } from "./ws.ts";

export type AppRouter = ReturnType<typeof createProviderRouter>;

export type AppConfig = {
  model?: string;
  agent?: string;
  sandbox?: {
    mode: "host" | "worktree" | "container" | "remote";
    envAllowlist?: string[];
    network?: { allowHosts?: string[] };
  };
  providers?: Record<string, Record<string, unknown>>;
  context?: {
    overflowThreshold?: number;
    windowTokens?: number;
    prune?: {
      enabled?: boolean;
      protectMinTokens?: number;
      minReclaim?: number;
      protectedTools?: string[];
    };
  };
  budget?: {
    preCompactTokenThreshold?: number;
    maxTurns?: number;
    maxUsdPerTask?: number;
  };
  memory?: {
    autoSummarize?: boolean;
    summarizeModel?: string;
    startupInjectCount?: number;
    rollingSummary?: boolean;
    autoInject?: string[];
  };
  observability?: {
    metrics?: boolean | { public?: boolean };
    recordContent?: boolean;
  };
  skills?: {
    autoLoad?: string[];
    loadPaths?: string[];
    catalog?: boolean;
    catalogMaxSkills?: number;
    catalogMaxDescriptionChars?: number;
  };
  tools?: {
    webfetch?: { allowedHosts?: string[]; maxBytes?: number };
  };
  instructions?: { files?: string[] };
  hooks?: HooksFile;
  worktreeCleanup?: "keep" | "remove";
};

const MODEL_CATALOG = [
  "mock/echo",
  "anthropic/claude-sonnet-4-20250514",
  "openai/gpt-4.1",
  "google/gemini-2.5-pro",
  "groq/llama-3.3-70b-versatile",
  "openrouter/anthropic/claude-3.5-sonnet",
];

const COMMAND_NAMES = [
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
  "revert",
] as const;

function isCommandDenied(
  value: unknown,
): value is { error: string; status: 400 } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === 400 &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

export function createApp(opts: {
  token: string;
  store: SessionStore;
  router: AppRouter;
  tools?: ToolRegistry;
  mcp?: McpPool;
  hooks?: HookRunner;
  observability?: Observability;
  config?: AppConfig;
  summarize?: SessionSummarizer;
  adapterIds?: string[];
  workspaceRoot?: string;
  remoteExec?: import("@zox/tools").ToolContext["remoteExec"];
}): Hono & {
  handleWebSocket: (
    request: Request,
    server: Bun.Server,
  ) => Response | undefined;
} {
  const bus = new SessionEventBus();
  const app = new Hono();
  const tools = opts.tools ?? defaultTools();
  const mcp = opts.mcp ?? new McpPool();
  const config: AppConfig = {
    model: "mock/echo",
    agent: "build",
    ...opts.config,
    sandbox: {
      mode: opts.config?.sandbox?.mode ?? DEFAULT_SANDBOX_CONFIG.mode,
      envAllowlist: opts.config?.sandbox?.envAllowlist,
      network: opts.config?.sandbox?.network,
    },
    providers: opts.config?.providers,
    hooks: opts.config?.hooks,
    memory: {
      autoSummarize: opts.config?.memory?.autoSummarize ?? true,
      summarizeModel: opts.config?.memory?.summarizeModel,
      startupInjectCount: opts.config?.memory?.startupInjectCount,
      rollingSummary: opts.config?.memory?.rollingSummary,
      autoInject: opts.config?.memory?.autoInject,
    },
    observability: opts.config?.observability,
  };
  const summarize: SessionSummarizer =
    opts.summarize ??
    createRouterSummarizer(opts.router, config.memory?.summarizeModel);
  const adapterIds = opts.adapterIds ?? ["mock"];
  const permissionWaiters = new Map<string, { resolve(v: boolean): void }>();
  const permissionDecisions = new Map<string, boolean>();
  const sessionPermissionIds = new Map<string, Set<string>>();
  const turnAborts = new Map<string, AbortController>();
  const processUsage = { inputTokens: 0, outputTokens: 0 };
  const resumedSessions = new Set<string>();
  const injectedDurableIds = new Map<string, string[]>();

  const permission: PermissionResponder = {
    wait(requestId) {
      const decided = permissionDecisions.get(requestId);
      if (decided !== undefined) {
        permissionDecisions.delete(requestId);
        return Promise.resolve(decided);
      }
      return new Promise<boolean>((resolve) => {
        permissionWaiters.set(requestId, { resolve });
      });
    },
  };

  async function attachResumedSession(
    session: StoredSession,
  ): Promise<{ error?: string }> {
    if (resumedSessions.has(session.id)) return {};
    resumedSessions.add(session.id);
    if (!existsSync(session.sandboxRoot)) {
      try {
        const sandbox = await ensureWorktree({
          workspaceRoot: session.workspaceRoot,
          sessionId: session.id,
          config: {
            ...DEFAULT_SANDBOX_CONFIG,
            mode: config.sandbox?.mode ?? "host",
          },
        });
        session.sandboxRoot = sandbox.root;
        session.sandboxMode = sandbox.mode;
      } catch (error) {
        resumedSessions.delete(session.id);
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (opts.hooks) {
      try {
        const start = await opts.hooks.run("SessionStart", {
          matcher: "resume",
          session: { id: session.id, workspaceRoot: session.workspaceRoot },
        });
        if (start.message?.trim()) {
          session.systemNotes = [
            ...(session.systemNotes ?? []),
            start.message.trim(),
          ];
        }
      } catch (error) {
        resumedSessions.delete(session.id);
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    opts.store.save(session);
    return {};
  }

  const auth = bearerAuth(opts.token);
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (c.req.method === "GET" && /^\/sessions\/[^/]+\/ws$/.test(path)) {
      await next();
      return;
    }
    return auth(c, next);
  });

  app.post("/sessions", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    const parsed = createSessionRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Bad request", issues: parsed.error.issues }, 400);
    }
    const session = opts.store.create({
      ...parsed.data,
      sandboxRoot: parsed.data.workspaceRoot,
    });
    try {
      const sandbox = await ensureWorktree({
        workspaceRoot: session.workspaceRoot,
        sessionId: session.id,
        config: {
          ...DEFAULT_SANDBOX_CONFIG,
          mode: config.sandbox?.mode ?? "host",
        },
      });
      session.sandboxRoot = sandbox.root;
      session.sandboxMode = sandbox.mode;
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
    loadAutoSkills(session, config.skills);
    opts.store.save(session);
    const autoLoaded = session.activeSkills ?? [];
    if (autoLoaded.length > 0) {
      if (opts.hooks) {
        await opts.hooks.run("InstructionsLoaded", {
          session: { id: session.id, workspaceRoot: session.workspaceRoot },
          skills: autoLoaded.map((skill) => ({
            name: skill.name,
            path: skill.path,
          })),
        });
      }
      for (const _skill of autoLoaded) {
        opts.observability?.recordSkillLoad("auto");
      }
      publishSkillsChanged(session);
    }
    if (opts.hooks) {
      const start = await opts.hooks.run("SessionStart", {
        matcher: "startup",
        session: { id: session.id, workspaceRoot: session.workspaceRoot },
      });
      if (start.message?.trim()) {
        session.systemNotes = [
          ...(session.systemNotes ?? []),
          start.message.trim(),
        ];
        opts.store.save(session);
      }
    }
    const durableDb = sqliteDatabase(opts.store);
    if (durableDb) {
      const loaded = await loadStartupMemories({
        db: durableDb,
        workspaceRoot: session.workspaceRoot,
        startupInjectCount: config.memory?.startupInjectCount,
        autoInject: config.memory?.autoInject,
      });
      injectedDurableIds.set(session.id, loaded.injectedDurableIds);
      if (loaded.notes.length > 0) {
        session.systemNotes = [...(session.systemNotes ?? []), ...loaded.notes];
        opts.store.save(session);
      }
    }
    resumedSessions.add(session.id);
    return c.json(sessionPayload(session), 201);
  });

  app.get("/sessions", (c) => {
    const workspaceRoot = c.req.query("workspaceRoot");
    if (!workspaceRoot) {
      return c.json({ error: "workspaceRoot required" }, 400);
    }
    const rawLimit = c.req.query("limit");
    const parsedLimit = rawLimit === undefined ? 50 : Number(rawLimit);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
    const sessions = opts.store
      .list({ workspaceRoot, limit })
      .map((session) => ({
        id: session.id,
        workspaceRoot: session.workspaceRoot,
        agent: session.agent,
        model: session.model,
        status: session.status,
        createdAt: session.createdAt ?? 0,
      }));
    return c.json({ sessions });
  });

  app.get("/sessions/:id", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const attached = await attachResumedSession(session);
    if (attached.error) {
      return c.json({ error: attached.error }, 400);
    }
    return c.json({
      ...sessionPayload(session),
      messages: session.messages,
    });
  });

  app.get("/sessions/:id/export", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const includeMemory = c.req.query("includeMemory") === "true";
    const json = await exportSession({
      session,
      includeMemory,
      readMemory: async () => {
        const db = sqliteDatabase(opts.store);
        if (!db) return [];
        return db
          .query<{ content: string }, [string]>(
            `SELECT content FROM memories
             WHERE workspace_root = ?
             ORDER BY pinned DESC, updated_at DESC`,
          )
          .all(session.workspaceRoot)
          .map((row) => row.content);
      },
    });
    return c.json(json);
  });

  app.post("/sessions/:id/messages", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const attached = await attachResumedSession(session);
    if (attached.error) {
      return c.json({ error: attached.error }, 400);
    }
    if (session.status !== "idle") {
      return c.json({ error: "Session not idle" }, 409);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    const parsed = sendMessageRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Bad request", issues: parsed.error.issues }, 400);
    }
    bus.beginTurn(session.id);
    session.status = "running";
    opts.store.save(session);
    const abort = new AbortController();
    turnAborts.set(session.id, abort);
    void runSessionTurn(session, parsed.data.content, abort).catch(
      (error: unknown) => {
        session.status = "error";
        opts.store.save(session);
        bus.publish(session.id, {
          type: "error",
          sessionId: session.id,
          message: error instanceof Error ? error.message : String(error),
        });
        bus.publish(session.id, {
          type: "session.status",
          sessionId: session.id,
          status: "error",
        });
      },
    );
    return c.json({ ok: true }, 202);
  });

  app.post("/sessions/:id/cancel", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    turnAborts.get(session.id)?.abort();
    const ids = sessionPermissionIds.get(session.id);
    if (ids) {
      for (const requestId of ids) {
        permissionWaiters.get(requestId)?.resolve(false);
        permissionWaiters.delete(requestId);
      }
      ids.clear();
    }
    return c.json({ ok: true });
  });

  app.post("/sessions/:id/permissions/:requestId", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    const approved =
      typeof json === "object" &&
      json !== null &&
      "approved" in json &&
      (json as { approved: unknown }).approved === true;
    const requestId = c.req.param("requestId");
    applyPermission(session.id, requestId, approved);
    return c.json({ ok: true, approved });
  });

  app.post("/sessions/:id/compact", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    try {
      await runCompact(session);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
    return c.json({ ok: true });
  });

  app.post("/sessions/:id/revert", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const db = sqliteDatabase(opts.store);
    if (!db) return c.json({ error: "Not found" }, 404);
    let json: unknown = {};
    try {
      json = await c.req.json();
    } catch {
      json = {};
    }
    const snapshotId =
      typeof json === "object" &&
      json !== null &&
      typeof (json as { snapshotId?: unknown }).snapshotId === "string"
        ? (json as { snapshotId: string }).snapshotId
        : undefined;
    try {
      const result = await restoreSnapshot({
        db,
        sessionId: session.id,
        snapshotId,
        sandboxRoot: session.sandboxRoot,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Snapshot not found") {
        return c.json({ error: "Not found" }, 404);
      }
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  app.post("/sessions/:id/commands", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    if (
      typeof json !== "object" ||
      json === null ||
      typeof (json as { name?: unknown }).name !== "string"
    ) {
      return c.json({ error: "Bad request" }, 400);
    }
    const name = (json as { name: string }).name.replace(/^\//, "");
    const args = Array.isArray((json as { args?: unknown }).args)
      ? ((json as { args: unknown[] }).args.filter(
          (a) => typeof a === "string",
        ) as string[])
      : [];
    if (name === "exit") {
      return c.json({ error: "/exit is client-only" }, 400);
    }
    const result = await dispatchCommand(session, name, args);
    if (isCommandDenied(result)) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  app.post("/sessions/:id/close", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    if (opts.hooks) {
      await opts.hooks.run("SessionEnd", {
        session: { id: session.id, workspaceRoot: session.workspaceRoot },
      });
    }
    const recentTexts = session.messages.slice(-20).map((m) => m.content);
    await autoSummarize({
      enabled: config.memory?.autoSummarize !== false,
      workspaceRoot: session.workspaceRoot,
      sessionId: session.id,
      planJson: session.planJson,
      priorStateMarkdown: session.priorStateMarkdown,
      compactionSummaries: (session.compactions ?? []).map((c) => c.summary),
      recentTexts,
      rollingSummary: config.memory?.rollingSummary === true,
      summarize,
    });
    if (session.sandboxMode === "worktree") {
      await removeWorktree({
        workspaceRoot: session.workspaceRoot,
        sessionId: session.id,
        config: {
          ...DEFAULT_SANDBOX_CONFIG,
          mode: "worktree",
          worktree: {
            ...DEFAULT_SANDBOX_CONFIG.worktree,
            cleanup: config.worktreeCleanup ?? "keep",
          },
        },
      });
    }
    opts.store.save(session);
    return c.json({ ok: true });
  });

  app.get("/sessions/:id/memory", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json({
      planJson: session.planJson,
      priorStateMarkdown: session.priorStateMarkdown ?? "",
      activeSkills: session.activeSkills ?? [],
      injectedDurableIds: injectedDurableIds.get(session.id) ?? [],
    });
  });

  app.post("/sessions/:id/memory", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    const db = sqliteDatabase(opts.store);
    if (!db)
      return c.json({ error: "Durable memory requires sqlite store" }, 400);
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    const parsed = writeMemoryRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Bad request", issues: parsed.error.issues }, 400);
    }
    const row = await writeDurableMemory(db, {
      workspaceRoot: session.workspaceRoot,
      content: parsed.data.content,
      pinned: parsed.data.pinned === true,
    });
    return c.json(row, 201);
  });

  app.get("/memory/search", (c) => {
    const q = c.req.query("q");
    const workspaceRoot = c.req.query("workspaceRoot");
    if (!q || !workspaceRoot) {
      return c.json({ error: "q and workspaceRoot required" }, 400);
    }
    const db = sqliteDatabase(opts.store);
    if (!db)
      return c.json({ error: "Durable memory requires sqlite store" }, 400);
    const memories = searchDurableMemories(db, q, workspaceRoot);
    return c.json({ memories });
  });

  app.get("/skills", (c) => {
    const workspaceRoot = c.req.query("workspaceRoot");
    if (!workspaceRoot) {
      return c.json({ error: "workspaceRoot required" }, 400);
    }
    const skills = discoverSkills({
      workspaceRoot,
      loadPaths: config.skills?.loadPaths,
    }).map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
    }));
    return c.json({ skills });
  });

  app.get("/sessions/:id/skills", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(sessionSkillsPayload(session));
  });

  app.post("/sessions/:id/skills", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    const parsed = mutateSessionSkillsRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Bad request", issues: parsed.error.issues }, 400);
    }
    if (parsed.data.action === "load") {
      const result = await loadSessionSkill(session, parsed.data.name, "slash");
      if ("error" in result) {
        return c.json({ error: result.error }, 400);
      }
    } else {
      unloadSessionSkill(session, parsed.data.name);
    }
    return c.json(sessionSkillsPayload(session));
  });

  app.get("/models", (c) => {
    const models = MODEL_CATALOG.filter((id) => {
      const provider = id.slice(0, id.indexOf("/"));
      return adapterIds.includes(provider);
    });
    return c.json({ adapters: adapterIds, models });
  });

  app.get("/usage", (c) => {
    const sessionId = c.req.query("sessionId");
    if (sessionId) {
      const session = opts.store.get(sessionId);
      if (!session) return c.json({ error: "Not found" }, 404);
      return c.json({
        inputTokens: session.usage.inputTokens,
        outputTokens: session.usage.outputTokens,
      });
    }
    return c.json(processUsage);
  });

  app.get("/config", (c) => c.json(redactConfig(config)));

  app.put("/config", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    if (typeof json !== "object" || json === null) {
      return c.json({ error: "Bad request" }, 400);
    }
    const body = json as Record<string, unknown>;
    if (typeof body.model === "string") config.model = body.model;
    if (typeof body.agent === "string") config.agent = body.agent;
    if (isRecord(body.sandbox) && typeof body.sandbox.mode === "string") {
      const mode = body.sandbox.mode;
      if (
        mode === "host" ||
        mode === "worktree" ||
        mode === "container" ||
        mode === "remote"
      ) {
        config.sandbox = { mode };
      }
    }
    return c.json(redactConfig(config));
  });

  app.post("/mcp/servers", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    if (
      typeof json !== "object" ||
      json === null ||
      typeof (json as { name?: unknown }).name !== "string" ||
      typeof (json as { command?: unknown }).command !== "string"
    ) {
      return c.json({ error: "Bad request" }, 400);
    }
    const body = json as {
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
    await mcp.add(body.name, {
      command: body.command,
      args: body.args,
      env: body.env,
    });
    for (const tool of mcp.asZoxTools()) tools.register(tool);
    return c.json({ ok: true, servers: mcp.list() }, 201);
  });

  app.delete("/mcp/servers/:name", async (c) => {
    unregisterMcpServer(c.req.param("name"));
    await mcp.remove(c.req.param("name"));
    return c.json({ ok: true, servers: mcp.list() });
  });

  app.get("/metrics", (c) => {
    const observability = opts.observability;
    if (!metricsEndpointEnabled(config, observability)) {
      return c.json({ error: "Not found" }, 404);
    }
    if (!metricsPublic(config) && !metricsClientIsLocal(c)) {
      return c.json({ error: "Not found" }, 404);
    }
    if (!observability) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.text(observability.renderPrometheus(), 200, {
      "Content-Type": "text/plain; version=0.0.4",
    });
  });

  app.get("/hooks", (c) => {
    const file = config.hooks;
    if (!file?.hooks) return c.json({ hooks: {} });
    const hooks: Record<
      string,
      Array<{ matcher: string; command: string }>
    > = {};
    for (const [event, entries] of Object.entries(file.hooks)) {
      if (!entries) continue;
      hooks[event] = entries.map((entry) => ({
        matcher: entry.matcher,
        command: commandPathOnly(entry.command ?? ""),
      }));
    }
    return c.json({ hooks });
  });

  app.post("/sessions/:id/hooks/test", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    if (!isRecord(json) || typeof json.event !== "string") {
      return c.json({ error: "Bad request" }, 400);
    }
    if (!opts.hooks) return c.json({ decision: "allow" });
    try {
      return c.json(await opts.hooks.run(json.event, json.payload));
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  app.get("/sessions/:id/ws", (c) => {
    const url = new URL(c.req.url);
    const header = c.req.header("Authorization") ?? "";
    const provided = header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : (url.searchParams.get("token") ?? undefined);
    if (provided !== opts.token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json({ error: "Upgrade required" }, 426);
  });

  // Phase 0: close SSE after session.status idle|error so app.request tests finish.
  app.get("/sessions/:id/events", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    if (session.status === "idle") {
      bus.discardCompletedTurn(session.id);
    }
    let id = 0;
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        let pendingWrites = 0;
        let sawTerminal = false;

        const tryFinish = (unsubscribe: () => void) => {
          if (sawTerminal && pendingWrites === 0) {
            unsubscribe();
            resolve();
          }
        };

        const unsubscribe = bus.subscribe(session.id, (event: ZoxEvent) => {
          pendingWrites++;
          void stream
            .writeSSE({
              id: String(id++),
              event: event.type,
              data: JSON.stringify(event),
            })
            .finally(() => {
              pendingWrites--;
              if (
                event.type === "session.status" &&
                (event.status === "idle" || event.status === "error")
              ) {
                sawTerminal = true;
              }
              tryFinish(unsubscribe);
            });
        });

        if (bus.turnComplete(session.id)) {
          sawTerminal = true;
          queueMicrotask(() => tryFinish(unsubscribe));
        }
      });
    });
  });

  const handleWebSocket = sessionWebSocket({
    token: opts.token,
    getSession: (id) => {
      const session = opts.store.get(id);
      return session ? { id: session.id } : undefined;
    },
    bus,
    respondPermission: applyPermission,
  });

  return Object.assign(app, { handleWebSocket });

  function applyPermission(
    sessionId: string,
    requestId: string,
    approved: boolean,
  ): void {
    const waiter = permissionWaiters.get(requestId);
    if (waiter) {
      waiter.resolve(approved);
      permissionWaiters.delete(requestId);
    } else {
      permissionDecisions.set(requestId, approved);
    }
    sessionPermissionIds.get(sessionId)?.delete(requestId);
  }

  async function runSessionTurn(
    session: StoredSession,
    userContent: string,
    abort: AbortController,
  ) {
    for (const tool of mcp.asZoxTools()) tools.register(tool);
    const wait: PermissionResponder = {
      wait(requestId) {
        let ids = sessionPermissionIds.get(session.id);
        if (!ids) {
          ids = new Set();
          sessionPermissionIds.set(session.id, ids);
        }
        ids.add(requestId);
        return permission.wait(requestId);
      },
    };
    let previousSkillNames = activeSkillNamesKey(session);
    const publishIfSkillsChanged = () => {
      const next = activeSkillNamesKey(session);
      if (next === previousSkillNames) return;
      previousSkillNames = next;
      publishSkillsChanged(session);
    };
    for await (const event of runTurn({
      session,
      userContent,
      router: {
        streamChat(params) {
          return opts.router.streamChat({
            ...params,
            abortSignal: abort.signal,
          });
        },
      },
      tools,
      permission: wait,
      hooks: opts.hooks,
      context: {
        windowTokens: config.context?.windowTokens,
      },
      overflowThreshold: config.context?.overflowThreshold,
      prune: {
        ...config.context?.prune,
        enabled: config.context?.prune?.enabled ?? false,
      },
      onOverflow: ({ kind, estimatedTokens }) =>
        runOverflowCompact(session, kind, estimatedTokens),
      observability: opts.observability,
      skillLoadPaths: config.skills?.loadPaths,
      webfetchAllowedHosts: config.tools?.webfetch?.allowedHosts,
      webfetchMaxBytes: config.tools?.webfetch?.maxBytes,
      remoteExec: opts.remoteExec,
      sandboxEnvAllowlist: config.sandbox?.envAllowlist,
      sandboxAllowHosts: config.sandbox?.network?.allowHosts,
      memoryDb: sqliteDatabase(opts.store),
      skillsConfig: {
        catalog: config.skills?.catalog,
        catalogMaxSkills: config.skills?.catalogMaxSkills,
        catalogMaxDescriptionChars: config.skills?.catalogMaxDescriptionChars,
      },
      instructionFiles: config.instructions?.files,
      preCompactTokenThreshold: config.budget?.preCompactTokenThreshold,
      maxTurns: config.budget?.maxTurns,
      maxUsdPerTask: config.budget?.maxUsdPerTask,
      onFileMutate: snapshotMutator(session, opts.store),
      afterFileMutate: async (filePath) => {
        const formatted = formatDiagnostics(
          await typescriptDiagnostics({
            sandboxRoot: session.sandboxRoot,
            filePath,
          }),
        );
        return formatted || undefined;
      },
    })) {
      if (event.type === "usage.turn") {
        processUsage.inputTokens += event.inputTokens;
        processUsage.outputTokens += event.outputTokens;
        opts.store.addUsage(session.id, {
          id: createId("usage"),
          sessionId: session.id,
          turnId: event.turnId,
          provider: event.provider,
          model: event.model,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
          durationMs: event.durationMs,
        });
      }
      bus.publish(session.id, event);
      opts.store.save(session);
      publishIfSkillsChanged();
    }
    turnAborts.delete(session.id);
    opts.store.save(session);
    publishIfSkillsChanged();
  }

  async function* runOverflowCompact(
    session: StoredSession,
    kind: "auto",
    estimatedTokens: number,
  ): AsyncIterable<ZoxEvent> {
    for await (const event of compactSessionTurn({
      session,
      summarize,
      hooks: opts.hooks,
      kind,
      estimatedTokens,
    })) {
      yield event;
    }
    opts.observability?.recordCompaction(kind);
    opts.store.save(session);
  }

  async function runCompact(
    session: StoredSession,
    kind: "manual" | "auto" = "manual",
  ) {
    bus.beginTurn(session.id);
    for await (const event of compactSessionTurn({
      session,
      summarize,
      hooks: opts.hooks,
      kind,
    })) {
      bus.publish(session.id, event);
    }
    opts.observability?.recordCompaction(kind);
    opts.store.save(session);
  }

  async function dispatchCommand(
    session: StoredSession,
    name: string,
    args: string[],
  ): Promise<unknown> {
    switch (name) {
      case "help":
        return { commands: [...COMMAND_NAMES] };
      case "model":
        if (args[0]) session.model = args[0];
        opts.store.save(session);
        return { model: session.model };
      case "agent":
        if (args[0]) session.agent = args[0];
        opts.store.save(session);
        return { agent: session.agent };
      case "compact":
        await runCompact(session);
        return { ok: true };
      case "context":
        return { estimatedTokens: estimateSession(session.messages) };
      case "usage":
        return {
          inputTokens: session.usage.inputTokens,
          outputTokens: session.usage.outputTokens,
        };
      case "clear":
        session.messages = [];
        session.compactions = [];
        session.planJson = null;
        session.priorStateMarkdown = undefined;
        session.systemNotes = [];
        session.usage = { inputTokens: 0, outputTokens: 0 };
        session.activeSkills = [];
        opts.store.save(session);
        publishSkillsChanged(session);
        return { ok: true };
      case "mcp":
        return dispatchMcp(args);
      case "skill": {
        if (args[0] === "-u") {
          const skillName = args[1];
          if (!skillName) return { error: "skill name required" };
          unloadSessionSkill(session, skillName);
          return { ok: true };
        }
        const skillName = args[0];
        if (!skillName) return { error: "skill name required" };
        const result = await loadSessionSkill(session, skillName, "slash");
        if ("error" in result) return result;
        const loaded = (session.activeSkills ?? []).find(
          (entry) => entry.name === skillName,
        );
        return { ok: true, skill: skillName, body: loaded?.body };
      }
      case "skills": {
        if (args[0] === "reload") {
          session.activeSkills = (session.activeSkills ?? []).flatMap(
            (active) => {
              const found = findSkill(active.name, discoveryOpts(session));
              return found
                ? [
                    {
                      name: found.name,
                      body: found.body,
                      path: found.path,
                    },
                  ]
                : [];
            },
          );
          opts.store.save(session);
          publishSkillsChanged(session);
          return sessionSkillsList(session);
        }
        if (args[0] === "unload") {
          const skillName = args[1];
          if (!skillName) return { error: "skill name required" };
          unloadSessionSkill(session, skillName);
          return { ok: true };
        }
        return sessionSkillsList(session);
      }
      case "cancel":
        turnAborts.get(session.id)?.abort();
        return { ok: true };
      case "sandbox":
        if (
          args[0] === "host" ||
          args[0] === "worktree" ||
          args[0] === "container" ||
          args[0] === "remote"
        ) {
          session.sandboxMode = args[0];
          opts.store.save(session);
        }
        return { sandboxMode: session.sandboxMode };
      case "trace":
        return { lastTraceId: session.lastTraceId ?? null };
      case "remember": {
        const content = args.join(" ").trim();
        if (!content) return { error: "text required" };
        const db = sqliteDatabase(opts.store);
        if (!db) return { error: "Durable memory requires sqlite store" };
        const row = await writeDurableMemory(db, {
          workspaceRoot: session.workspaceRoot,
          content,
          pinned: true,
        });
        return { ok: true, id: row.id, pinned: true };
      }
      case "revert": {
        const db = sqliteDatabase(opts.store);
        if (!db) return { error: "Snapshots require sqlite store" };
        try {
          return await restoreSnapshot({
            db,
            sessionId: session.id,
            snapshotId: args[0],
            sandboxRoot: session.sandboxRoot,
          });
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      default:
        return dispatchPluginCommand(session, name, args);
    }
  }

  async function dispatchPluginCommand(
    session: StoredSession,
    name: string,
    args: string[],
  ): Promise<unknown> {
    const plugin = await resolveCustomSlash({
      workspaceRoot: session.workspaceRoot,
      name,
      args,
    });
    if (plugin.kind === "prompt") {
      if (opts.hooks) {
        const expansion = await opts.hooks.run("UserPromptExpansion", {
          prompt: plugin.content,
          matcher: name,
          session: {
            id: session.id,
            workspaceRoot: session.workspaceRoot,
          },
        });
        if (expansion.decision === "deny") {
          return {
            error: expansion.reason ?? expansion.message ?? "Denied",
            status: 400 as const,
          };
        }
      }
      return { type: "expand", content: plugin.content };
    }
    if (plugin.kind === "json") {
      return plugin.value;
    }
    return { error: `Unknown command: ${name}` };
  }

  async function dispatchMcp(args: string[]): Promise<unknown> {
    const action = args[0] ?? "list";
    if (action === "list") return { servers: mcp.list() };
    if (action === "add" && args[1] && args[2]) {
      await mcp.add(args[1], { command: args[2], args: args.slice(3) });
      for (const tool of mcp.asZoxTools()) tools.register(tool);
      return { servers: mcp.list() };
    }
    if (action === "remove" && args[1]) {
      unregisterMcpServer(args[1]);
      await mcp.remove(args[1]);
      return { servers: mcp.list() };
    }
    return { error: "usage: mcp list|add|remove" };
  }

  function unregisterMcpServer(name: string): void {
    const listed = mcp.list().find((server) => server.name === name);
    if (!listed) return;
    for (const toolName of listed.tools) tools.unregister(toolName);
  }

  function discoveryOpts(session: StoredSession): SkillDiscoveryOptions {
    return {
      workspaceRoot: session.workspaceRoot,
      loadPaths: config.skills?.loadPaths,
    };
  }

  function activeSkillNamesKey(session: StoredSession): string {
    return (session.activeSkills ?? []).map((skill) => skill.name).join("\0");
  }

  function publishSkillsChanged(session: StoredSession): void {
    bus.publish(session.id, {
      type: "skills.changed",
      sessionId: session.id,
      active: (session.activeSkills ?? []).map((s) => s.name),
    });
  }

  async function loadSessionSkill(
    session: StoredSession,
    name: string,
    source: "slash" | "auto",
  ): Promise<{ ok: true } | { error: string }> {
    const skill = findSkill(name, discoveryOpts(session));
    if (!skill) return { error: `Skill not found: ${name}` };
    session.activeSkills = activateSkill(session.activeSkills ?? [], {
      name: skill.name,
      body: skill.body,
      path: skill.path,
    });
    opts.store.save(session);
    if (opts.hooks) {
      await opts.hooks.run("InstructionsLoaded", {
        session: { id: session.id, workspaceRoot: session.workspaceRoot },
        skills: [{ name: skill.name, path: skill.path }],
      });
    }
    opts.observability?.recordSkillLoad(source);
    publishSkillsChanged(session);
    return { ok: true };
  }

  function unloadSessionSkill(session: StoredSession, name: string): void {
    session.activeSkills = deactivateSkill(session.activeSkills ?? [], name);
    opts.store.save(session);
    publishSkillsChanged(session);
  }

  function sessionSkillsPayload(session: StoredSession) {
    const activeNames = new Set(
      (session.activeSkills ?? []).map((skill) => skill.name),
    );
    return {
      catalog: discoverSkills(discoveryOpts(session)).map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.path,
        loaded: activeNames.has(skill.name),
      })),
      active: session.activeSkills ?? [],
    };
  }

  function sessionSkillsList(session: StoredSession) {
    const activeNames = new Set(
      (session.activeSkills ?? []).map((skill) => skill.name),
    );
    return {
      skills: discoverSkills(discoveryOpts(session)).map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.path,
        loaded: activeNames.has(skill.name),
      })),
    };
  }
}

function defaultTools(): ToolRegistry {
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  return tools;
}

function sqliteDatabase(store: SessionStore) {
  if (store instanceof SqliteSessionStore) return store.db;
  return undefined;
}

function snapshotMutator(
  session: StoredSession,
  store: SessionStore,
): ((path: string) => Promise<void>) | undefined {
  const db = sqliteDatabase(store);
  if (!db) return undefined;
  return async (path: string) => {
    await recordFileSnapshot({
      db,
      sessionId: session.id,
      sandboxRoot: session.sandboxRoot,
      relativePath: path,
    });
  };
}

function sessionPayload(session: StoredSession) {
  return {
    id: session.id,
    workspaceRoot: session.workspaceRoot,
    agent: session.agent,
    model: session.model,
    status: session.status,
  };
}

function redactConfig(config: AppConfig): unknown {
  return redactValue(config);
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "apiKeyEnv") {
      out[key] = nested;
      continue;
    }
    if (/apiKey/i.test(key) || /secret|password|^token$/i.test(key)) {
      continue;
    }
    out[key] = redactValue(nested);
  }
  return out;
}

function commandPathOnly(command: string): string {
  const parts = command.trim().split(/\s+/);
  const pathLike =
    [...parts]
      .reverse()
      .find((part) => part.includes("/") || part.endsWith(".sh")) ?? parts[0];
  return pathLike ?? command;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metricsEndpointEnabled(
  config: AppConfig,
  observability?: Observability,
): boolean {
  if (!observability) return false;
  if (config.observability?.metrics === false) return false;
  return true;
}

function metricsPublic(config: AppConfig): boolean {
  const metrics = config.observability?.metrics;
  return (
    typeof metrics === "object" && metrics !== null && metrics.public === true
  );
}

function loadAutoSkills(
  session: StoredSession,
  skills?: AppConfig["skills"],
): void {
  for (const name of skills?.autoLoad ?? []) {
    const skill = findSkill(name, {
      workspaceRoot: session.workspaceRoot,
      loadPaths: skills?.loadPaths,
    });
    if (!skill) continue;
    session.activeSkills = activateSkill(session.activeSkills ?? [], {
      name: skill.name,
      body: skill.body,
      path: skill.path,
    });
  }
}

function createRouterSummarizer(
  router: AppRouter,
  model?: string,
): SessionSummarizer {
  return async (prompt) => {
    if (!model) return "compacted";
    try {
      router.resolve(model);
    } catch {
      return "compacted";
    }
    let text = "";
    for await (const event of router.streamChat({
      model,
      messages: [{ role: "user", content: prompt }],
    })) {
      if (event.type === "text-delta") text += event.text;
    }
    return text || "compacted";
  };
}

function metricsClientIsLocal(c: {
  req: { raw: Request };
  env?: unknown;
}): boolean {
  try {
    const { remote } = getConnInfo(c as Parameters<typeof getConnInfo>[0]);
    const address = remote.address;
    if (!address) return true;
    return address === "127.0.0.1" || address === "::1";
  } catch {
    return true;
  }
}
