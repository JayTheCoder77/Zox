import { estimateSession } from "@zox/context";
import {
  createSessionRequestSchema,
  sendMessageRequestSchema,
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
import { McpPool } from "@zox/mcp";
import { autoSummarize } from "@zox/memory";
import type { Observability } from "@zox/observability";
import type { createProviderRouter } from "@zox/providers";
import { DEFAULT_SANDBOX_CONFIG, ensureWorktree } from "@zox/sandbox";
import { findSkill } from "@zox/skills";
import { createBuiltinTools, ToolRegistry } from "@zox/tools";
import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { bearerAuth } from "./auth.ts";
import { SessionEventBus } from "./bus.ts";

export type AppRouter = ReturnType<typeof createProviderRouter>;

export type AppConfig = {
  model?: string;
  agent?: string;
  sandbox?: { mode: "host" | "worktree" | "container" | "remote" };
  providers?: Record<string, Record<string, unknown>>;
  memory?: { autoSummarize?: boolean };
  observability?: { metrics?: boolean | { public?: boolean } };
  hooks?: HooksFile;
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
  "cancel",
  "sandbox",
  "trace",
] as const;

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
}): Hono {
  const bus = new SessionEventBus();
  const app = new Hono();
  const tools = opts.tools ?? defaultTools();
  const mcp = opts.mcp ?? new McpPool();
  const config: AppConfig = {
    model: "mock/echo",
    agent: "build",
    ...opts.config,
    sandbox: {
      mode: opts.config?.sandbox?.mode ?? "host",
    },
    providers: opts.config?.providers,
    hooks: opts.config?.hooks,
    memory: {
      autoSummarize: opts.config?.memory?.autoSummarize ?? true,
    },
    observability: opts.config?.observability,
  };
  const summarize: SessionSummarizer =
    opts.summarize ?? (async () => "compacted");
  const adapterIds = opts.adapterIds ?? ["mock"];
  const permissionWaiters = new Map<string, { resolve(v: boolean): void }>();
  const permissionDecisions = new Map<string, boolean>();
  const sessionPermissionIds = new Map<string, Set<string>>();
  const turnAborts = new Map<string, AbortController>();
  const activeSkills = new Map<string, string[]>();
  const processUsage = { inputTokens: 0, outputTokens: 0 };

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

  app.use("*", bearerAuth(opts.token));

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
    opts.store.save(session);
    if (opts.hooks) {
      await opts.hooks.run("SessionStart", {
        matcher: "startup",
        session: { id: session.id, workspaceRoot: session.workspaceRoot },
      });
    }
    return c.json(sessionPayload(session), 201);
  });

  app.get("/sessions/:id", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(sessionPayload(session));
  });

  app.post("/sessions/:id/messages", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
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
    const waiter = permissionWaiters.get(requestId);
    if (waiter) {
      waiter.resolve(approved);
      permissionWaiters.delete(requestId);
    } else {
      permissionDecisions.set(requestId, approved);
    }
    sessionPermissionIds.get(session.id)?.delete(requestId);
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
      recentTexts,
      summarize,
    });
    opts.store.save(session);
    return c.json({ ok: true });
  });

  app.get("/sessions/:id/memory", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json({
      planJson: session.planJson,
      priorStateMarkdown: session.priorStateMarkdown ?? "",
      activeSkills: activeSkills.get(session.id) ?? [],
    });
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
        command: commandPathOnly(entry.command),
      }));
    }
    return c.json({ hooks });
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

  return app;

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
      observability: opts.observability,
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
          durationMs: event.durationMs,
        });
      }
      bus.publish(session.id, event);
      opts.store.save(session);
    }
    turnAborts.delete(session.id);
    opts.store.save(session);
  }

  async function runCompact(session: StoredSession) {
    bus.beginTurn(session.id);
    for await (const event of compactSessionTurn({
      session,
      summarize,
      hooks: opts.hooks,
    })) {
      bus.publish(session.id, event);
    }
    opts.observability?.recordCompaction("manual");
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
        opts.store.save(session);
        return { ok: true };
      case "mcp":
        return dispatchMcp(args);
      case "skill": {
        const skillName = args[0];
        if (!skillName) return { error: "skill name required" };
        const skill = findSkill(skillName, {
          workspaceRoot: session.workspaceRoot,
        });
        if (!skill) return { error: `Skill not found: ${skillName}` };
        const loaded = activeSkills.get(session.id) ?? [];
        if (!loaded.includes(skillName)) loaded.push(skillName);
        activeSkills.set(session.id, loaded);
        return { ok: true, skill: skillName };
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
      default:
        return { error: `Unknown command: ${name}` };
    }
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
      await mcp.remove(args[1]);
      return { servers: mcp.list() };
    }
    return { error: "usage: mcp list|add|remove" };
  }
}

function defaultTools(): ToolRegistry {
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  return tools;
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
