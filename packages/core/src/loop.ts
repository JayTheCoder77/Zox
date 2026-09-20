import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  assembleProviderMessages,
  buildEnvironmentPrompt,
  estimateSession,
  loadProjectInstructions,
  type PruneOptions,
  selectFamilyPrompt,
} from "@zox/context";
import type { ZoxEvent } from "@zox/contracts";
import type { PromptJudge, PromptJudgeResult } from "@zox/judge";
import { parsePlan } from "@zox/memory";
import type {
  ChatMessage,
  StreamChatParams,
  StreamEvent,
  ToolCall,
} from "@zox/providers";
import {
  activateSkill,
  buildSkillsCatalog,
  type CatalogOptions,
  discoverSkills,
} from "@zox/skills";
import type { ToolRegistry, ToolResult } from "@zox/tools";
import { getAgentProfile, toolMatchesProfile } from "./agents.ts";
import { createId } from "./ids.ts";
import { evaluatePermission } from "./permissions.ts";
import { runSoftPreCompact } from "./soft-compact.ts";
import type { StoredMessage, StoredSession } from "./store.ts";

const DEFAULT_PRE_COMPACT_TOKEN_THRESHOLD = 150_000;

const MAX_TOOL_ITERATIONS = 20;
const UNKNOWN_WINDOW_TOKENS = 128_000;
export const OVERFLOW_THRESHOLD = 0.85;
const KNOWN_OVERFLOW_RATIO = OVERFLOW_THRESHOLD;
const UNKNOWN_OVERFLOW_RATIO = 0.75;
const MAX_TOOL_OUTPUT_CHARS = 32_000;

export type TurnRouter = {
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
};

export type PermissionResponder = {
  wait(requestId: string): Promise<boolean>;
};

export type HookOutput = {
  decision: "allow" | "deny" | "ask";
  reason?: string;
  message?: string;
  updatedInput?: Record<string, unknown>;
};

export type HookRunner = {
  run(event: string, payload: unknown): Promise<HookOutput>;
};

export type ContextEngine = {
  estimateTokens?(text: string): number;
  windowTokens?: number;
};

export type TurnObservability = {
  startTurn(attrs?: { "zox.skills.active"?: string }): {
    end(): void;
    traceId: string;
  };
  recordTool(name: string, denied: boolean): void;
  recordTokens(provider: string, input: number, output: number): void;
  recordModelLatency?(seconds: number): void;
  recordContextEstimated?(tokens: number): void;
  recordSkillLoad?(source: "slash" | "tool" | "auto"): void;
  recordJudge?(info: {
    latencyMs: number;
    outcome: "allow" | "deny" | "ask" | "skipped";
    question?: string;
    reason?: string;
    prompt?: string;
  }): void;
  withTool?<T>(name: string, fn: () => Promise<T>): Promise<T>;
};

export type { PromptJudge, PromptJudgeResult };

async function* reviewHumanPrompt(opts: {
  session: StoredSession;
  userContent: string;
  judge?: PromptJudge;
  permission?: PermissionResponder;
  observability?: TurnObservability;
  ids?: {
    requestId(): string;
  };
}): AsyncGenerator<ZoxEvent, boolean> {
  const judge = opts.judge;
  if (!judge) return false;
  const started = performance.now();
  const result = await judge.review({
    prompt: opts.userContent,
    workspaceRoot: opts.session.workspaceRoot,
  });
  const latencyMs = performance.now() - started;
  opts.observability?.recordJudge?.({
    latencyMs,
    outcome: result.outcome,
    question: result.outcome === "skipped" ? undefined : result.question,
    reason: result.reason,
    prompt: opts.userContent,
  });

  if (result.outcome === "skipped") {
    yield {
      type: "prompt.guardrail",
      sessionId: opts.session.id,
      outcome: "skipped",
      reason: result.reason,
    };
    return false;
  }

  yield {
    type: "prompt.guardrail",
    sessionId: opts.session.id,
    outcome: result.outcome,
    question: result.question,
    pYes: result.pYes,
    confidence: result.confidence,
    reason: result.reason,
  };

  if (result.outcome === "allow") {
    return false;
  }

  if (result.outcome === "ask") {
    const requestId = opts.ids?.requestId() ?? createId("req");
    opts.session.status = "awaiting_permission";
    yield {
      type: "session.status",
      sessionId: opts.session.id,
      status: "awaiting_permission",
    };
    yield {
      type: "prompt.permission_required",
      sessionId: opts.session.id,
      requestId,
      question: result.question,
      reason: result.reason,
    };
    const approved = opts.permission
      ? await opts.permission.wait(requestId)
      : false;
    if (approved) {
      opts.session.status = "running";
      yield {
        type: "session.status",
        sessionId: opts.session.id,
        status: "running",
      };
      return false;
    }
  }

  yield {
    type: "prompt.blocked",
    sessionId: opts.session.id,
    question: result.question ?? "injection",
    reason: result.reason ?? "Prompt blocked by guardrail",
    pYes: result.pYes ?? 0,
    confidence: result.confidence ?? 0,
  };
  opts.session.status = "idle";
  yield {
    type: "session.status",
    sessionId: opts.session.id,
    status: "idle",
  };
  return true;
}

export async function* runTurn(opts: {
  session: StoredSession;
  userContent: string;
  router: TurnRouter;
  tools: ToolRegistry;
  permission?: PermissionResponder;
  hooks?: HookRunner;
  judge?: PromptJudge;
  skipJudge?: boolean;
  context?: ContextEngine;
  overflowThreshold?: number;
  prune?: PruneOptions;
  onOverflow?: (info: {
    kind: "auto";
    estimatedTokens: number;
  }) => Promise<void> | AsyncIterable<ZoxEvent>;
  observability?: TurnObservability;
  skillLoadPaths?: string[];
  webfetchAllowedHosts?: string[];
  webfetchMaxBytes?: number;
  remoteExec?: import("@zox/tools").ToolContext["remoteExec"];
  sandboxEnvAllowlist?: string[];
  sandboxAllowHosts?: string[];
  memoryDb?: import("bun:sqlite").Database;
  skillsConfig?: CatalogOptions;
  instructionFiles?: string[];
  preCompactTokenThreshold?: number;
  maxTurns?: number;
  maxUsdPerTask?: number;
  onFileMutate?: (path: string) => Promise<void>;
  afterFileMutate?: (path: string) => Promise<string | undefined>;
  ids?: {
    messageId(): string;
    turnId(): string;
    toolCallId(): string;
    requestId(): string;
  };
}): AsyncIterable<ZoxEvent> {
  const turnObs = opts.observability?.startTurn({
    "zox.skills.active": (opts.session.activeSkills ?? [])
      .map((s) => s.name)
      .join(","),
  });
  try {
    if (turnObs) {
      opts.session.lastTraceId = turnObs.traceId;
    }
    yield* runTurnBody(opts);
  } finally {
    turnObs?.end();
  }
}

async function* runTurnBody(opts: {
  session: StoredSession;
  userContent: string;
  router: TurnRouter;
  tools: ToolRegistry;
  permission?: PermissionResponder;
  hooks?: HookRunner;
  judge?: PromptJudge;
  skipJudge?: boolean;
  context?: ContextEngine;
  overflowThreshold?: number;
  prune?: PruneOptions;
  onOverflow?: (info: {
    kind: "auto";
    estimatedTokens: number;
  }) => Promise<void> | AsyncIterable<ZoxEvent>;
  observability?: TurnObservability;
  skillLoadPaths?: string[];
  webfetchAllowedHosts?: string[];
  webfetchMaxBytes?: number;
  remoteExec?: import("@zox/tools").ToolContext["remoteExec"];
  sandboxEnvAllowlist?: string[];
  sandboxAllowHosts?: string[];
  memoryDb?: import("bun:sqlite").Database;
  skillsConfig?: CatalogOptions;
  instructionFiles?: string[];
  preCompactTokenThreshold?: number;
  maxTurns?: number;
  maxUsdPerTask?: number;
  onFileMutate?: (path: string) => Promise<void>;
  afterFileMutate?: (path: string) => Promise<string | undefined>;
  ids?: {
    messageId(): string;
    turnId(): string;
    toolCallId(): string;
    requestId(): string;
  };
}): AsyncIterable<ZoxEvent> {
  opts.session.turnCount = (opts.session.turnCount ?? 0) + 1;
  if (opts.maxTurns !== undefined && opts.session.turnCount > opts.maxTurns) {
    yield {
      type: "budget.exceeded",
      sessionId: opts.session.id,
      reason: "max_turns",
    };
    opts.session.status = "idle";
    yield {
      type: "session.status",
      sessionId: opts.session.id,
      status: "idle",
    };
    return;
  }
  if (
    opts.maxUsdPerTask !== undefined &&
    (opts.session.usageUsd ?? 0) > opts.maxUsdPerTask
  ) {
    yield {
      type: "budget.exceeded",
      sessionId: opts.session.id,
      reason: "max_usd",
    };
    opts.session.status = "idle";
    yield {
      type: "session.status",
      sessionId: opts.session.id,
      status: "idle",
    };
    return;
  }

  const messageId = opts.ids?.messageId() ?? createId("msg");
  const turnId = opts.ids?.turnId() ?? createId("turn");
  const userId = createId("msg");
  opts.session.messages.push({
    id: userId,
    role: "user",
    content: opts.userContent,
  });
  opts.session.status = "running";
  yield {
    type: "session.status",
    sessionId: opts.session.id,
    status: "running",
  };

  if (opts.judge && !opts.skipJudge) {
    const blocked = yield* reviewHumanPrompt(opts);
    if (blocked) return;
  }

  if (opts.hooks) {
    const promptHook = await opts.hooks.run("UserPromptSubmit", {
      prompt: opts.userContent,
      session: {
        id: opts.session.id,
        workspaceRoot: opts.session.workspaceRoot,
      },
    });
    if (promptHook.decision === "deny") {
      opts.session.status = "error";
      yield {
        type: "error",
        sessionId: opts.session.id,
        message: promptHook.message ?? promptHook.reason ?? "Hook denied",
      };
      yield {
        type: "session.status",
        sessionId: opts.session.id,
        status: "error",
      };
      return;
    }
    if (promptHook.message?.trim()) {
      appendSystemNote(opts.session, promptHook.message.trim());
    }
  }

  const promptLayers = await resolvePromptLayers(
    opts.session,
    opts.instructionFiles,
  );
  const estimated = estimateTurnTokens({ ...opts, promptLayers });
  const hardOverflow = isHardOverflow(
    estimated,
    opts.context,
    opts.overflowThreshold,
  );
  yield* emitContextWarnings(
    opts.session,
    estimated,
    opts.context,
    opts.observability,
    opts.overflowThreshold,
  );

  if (hardOverflow) {
    try {
      const overflowResult = opts.onOverflow?.({
        kind: "auto",
        estimatedTokens: estimated,
      });
      if (overflowResult) {
        if (isAsyncIterable(overflowResult)) {
          for await (const event of overflowResult) {
            if (event.type === "session.status" && event.status === "idle") {
              continue;
            }
            yield event;
          }
        } else {
          await overflowResult;
        }
        opts.session.status = "running";
        yield {
          type: "session.status",
          sessionId: opts.session.id,
          status: "running",
        };
      } else {
        opts.session.status = "running";
      }
    } catch (error) {
      opts.session.status = "error";
      yield {
        type: "error",
        sessionId: opts.session.id,
        message: error instanceof Error ? error.message : String(error),
        code: "context.compact_failed",
      };
      yield {
        type: "session.status",
        sessionId: opts.session.id,
        status: "error",
      };
      return;
    }
  }

  const threshold =
    opts.preCompactTokenThreshold ?? DEFAULT_PRE_COMPACT_TOKEN_THRESHOLD;
  if (
    estimated >= threshold &&
    !hardOverflow &&
    !opts.session.softPreCompactPending
  ) {
    await runSoftPreCompact({
      session: opts.session,
      hooks: opts.hooks,
      estimatedTokens: estimated,
    });
    opts.session.softPreCompactPending = true;
  }

  const profile = getAgentProfile(opts.session.agent);
  const toolSchemas = opts.tools
    .list()
    .filter((tool) => toolMatchesProfile(profile.tools, tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

  let finalText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const started = Date.now();
  let toolIterations = 0;
  let stopForced = false;

  try {
    while (true) {
      const round = yield* consumeModelRound({
        session: opts.session,
        router: opts.router,
        messageId,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        observability: opts.observability,
        skillLoadPaths: opts.skillLoadPaths,
        skillsConfig: opts.skillsConfig,
        promptLayers,
        prune: opts.prune,
      });

      if (round.kind === "error") {
        opts.session.status = "error";
        yield {
          type: "error",
          sessionId: opts.session.id,
          message: round.message,
        };
        yield {
          type: "session.status",
          sessionId: opts.session.id,
          status: "error",
        };
        return;
      }

      inputTokens += round.inputTokens;
      outputTokens += round.outputTokens;
      cacheReadTokens += round.cacheReadTokens;
      cacheWriteTokens += round.cacheWriteTokens;
      finalText = round.text;

      if (round.toolCalls.length === 0) {
        if (opts.hooks && !stopForced) {
          const stop = await opts.hooks.run("Stop", {
            session: {
              id: opts.session.id,
              workspaceRoot: opts.session.workspaceRoot,
            },
          });
          if (stop.decision === "deny") {
            stopForced = true;
            continue;
          }
        }
        break;
      }

      toolIterations += 1;
      if (toolIterations > MAX_TOOL_ITERATIONS) {
        opts.session.status = "error";
        yield {
          type: "error",
          sessionId: opts.session.id,
          message: "Tool loop iteration limit reached",
          code: "tool_loop_limit",
        };
        yield {
          type: "session.status",
          sessionId: opts.session.id,
          status: "error",
        };
        return;
      }

      opts.session.messages.push({
        id: createId("msg"),
        role: "assistant",
        content: round.text,
        toolCalls: round.toolCalls,
      });

      for (const call of round.toolCalls) {
        yield* executeToolCall({
          call,
          opts,
          profileTools: profile.tools,
          ruleset: profile.ruleset,
        });
      }
      if (round.toolCalls.length > 0) {
        await opts.hooks?.run("PostToolBatch", {
          matcher: "*",
          session: {
            id: opts.session.id,
            workspaceRoot: opts.session.workspaceRoot,
          },
        });
      }
    }
  } catch (error) {
    opts.session.status = "error";
    yield {
      type: "error",
      sessionId: opts.session.id,
      message: error instanceof Error ? error.message : String(error),
    };
    yield {
      type: "session.status",
      sessionId: opts.session.id,
      status: "error",
    };
    return;
  }

  const { providerId } = splitProvider(opts.session.model);
  opts.observability?.recordTokens(providerId, inputTokens, outputTokens);
  opts.session.usage.inputTokens += inputTokens;
  opts.session.usage.outputTokens += outputTokens;

  const estimatedUsd: number | undefined = undefined;

  yield {
    type: "usage.turn",
    sessionId: opts.session.id,
    turnId,
    provider: providerId,
    model: opts.session.model,
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
    durationMs: Date.now() - started,
    estimatedUsd,
  };

  if (typeof estimatedUsd === "number") {
    opts.session.usageUsd = (opts.session.usageUsd ?? 0) + estimatedUsd;
  }

  if (
    opts.maxUsdPerTask !== undefined &&
    (opts.session.usageUsd ?? 0) > opts.maxUsdPerTask
  ) {
    yield {
      type: "budget.exceeded",
      sessionId: opts.session.id,
      reason: "max_usd",
    };
    opts.session.status = "idle";
    yield {
      type: "usage.session",
      sessionId: opts.session.id,
      inputTokens: opts.session.usage.inputTokens,
      outputTokens: opts.session.usage.outputTokens,
    };
    yield {
      type: "session.status",
      sessionId: opts.session.id,
      status: "idle",
    };
    return;
  }

  yield {
    type: "usage.session",
    sessionId: opts.session.id,
    inputTokens: opts.session.usage.inputTokens,
    outputTokens: opts.session.usage.outputTokens,
  };

  opts.session.messages.push({
    id: messageId,
    role: "assistant",
    content: finalText,
  });
  opts.session.status = "idle";
  yield {
    type: "message.completed",
    sessionId: opts.session.id,
    messageId,
    role: "assistant",
    content: finalText,
  };
  yield {
    type: "session.status",
    sessionId: opts.session.id,
    status: "idle",
  };
}

function assembleSessionMessages(
  session: StoredSession,
  skillLoadPaths?: string[],
  skillsConfig?: CatalogOptions,
  promptLayers?: PromptLayers,
  prune: PruneOptions = { enabled: false },
) {
  return assembleProviderMessages({
    messages: session.messages,
    compactions: session.compactions,
    familyPrompt: promptLayers?.familyPrompt,
    agentOverlay: promptLayers?.agentOverlay,
    environment: promptLayers?.environment,
    projectInstructions: promptLayers?.projectInstructions,
    skillsCatalog: buildSkillsCatalog(
      discoverSkills({
        workspaceRoot: session.workspaceRoot,
        loadPaths: skillLoadPaths,
      }),
      skillsConfig,
    ),
    skillBodies: session.activeSkills?.map((skill) => skill.body),
    priorStateMarkdown: session.priorStateMarkdown,
    systemNotes: session.systemNotes,
    prune,
  });
}

type PromptLayers = {
  familyPrompt: string;
  agentOverlay: string;
  environment: string;
  projectInstructions: string;
};

async function resolvePromptLayers(
  session: StoredSession,
  instructionFiles?: string[],
): Promise<PromptLayers> {
  const profile = getAgentProfile(session.agent);
  const projectInstructions = await loadProjectInstructions({
    workspaceRoot: session.workspaceRoot,
    extraFiles: instructionFiles,
  });
  return {
    familyPrompt: selectFamilyPrompt(session.model),
    agentOverlay: profile.systemOverlay,
    environment: buildEnvironmentPrompt({
      model: session.model,
      workingDirectory: session.sandboxRoot,
      workspaceRoot: session.workspaceRoot,
      isGitRepo: existsSync(join(session.workspaceRoot, ".git")),
      platform: process.platform,
      date: new Date().toDateString(),
    }),
    projectInstructions,
  };
}

function estimateTurnTokens(opts: {
  session: StoredSession;
  context?: ContextEngine;
  skillLoadPaths?: string[];
  skillsConfig?: CatalogOptions;
  promptLayers?: PromptLayers;
  prune?: PruneOptions;
}): number {
  const assembled = assembleSessionMessages(
    opts.session,
    opts.skillLoadPaths,
    opts.skillsConfig,
    opts.promptLayers,
    opts.prune,
  );
  return opts.context?.estimateTokens
    ? opts.context.estimateTokens(
        assembled.map((message) => message.content).join(""),
      )
    : estimateSession(assembled);
}

function isHardOverflow(
  estimated: number,
  context?: ContextEngine,
  overflowThreshold?: number,
): boolean {
  const knownWindow = context?.windowTokens;
  if (knownWindow === undefined) {
    return estimated > UNKNOWN_WINDOW_TOKENS * UNKNOWN_OVERFLOW_RATIO;
  }
  const ratio = overflowThreshold ?? KNOWN_OVERFLOW_RATIO;
  return estimated > knownWindow * ratio;
}

async function* emitContextWarnings(
  session: StoredSession,
  estimated: number,
  context?: ContextEngine,
  observability?: TurnObservability,
  overflowThreshold?: number,
): AsyncIterable<ZoxEvent> {
  observability?.recordContextEstimated?.(estimated);
  const knownWindow = context?.windowTokens;
  yield {
    type: "context.estimated",
    sessionId: session.id,
    estimatedTokens: estimated,
    windowTokens: knownWindow ?? UNKNOWN_WINDOW_TOKENS,
    windowKnown: knownWindow !== undefined,
  };
  if (knownWindow === undefined) {
    if (!session.windowWarned) {
      session.windowWarned = true;
      yield {
        type: "error",
        sessionId: session.id,
        message: "Context window size is unknown",
        code: "context.window_unknown",
      };
    }
  }
  if (isHardOverflow(estimated, context, overflowThreshold)) {
    yield {
      type: "context.overflow",
      sessionId: session.id,
      estimatedTokens: estimated,
    };
  }
}

function isAsyncIterable(
  value: Promise<void> | AsyncIterable<ZoxEvent>,
): value is AsyncIterable<ZoxEvent> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

type ModelRound =
  | {
      kind: "ok";
      text: string;
      toolCalls: ToolCall[];
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    }
  | { kind: "error"; message: string };

async function* consumeModelRound(opts: {
  session: StoredSession;
  router: TurnRouter;
  messageId: string;
  tools?: StreamChatParams["tools"];
  observability?: TurnObservability;
  skillLoadPaths?: string[];
  skillsConfig?: CatalogOptions;
  promptLayers?: PromptLayers;
  prune?: PruneOptions;
}): AsyncGenerator<ZoxEvent, ModelRound> {
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const toolCalls: ToolCall[] = [];
  const modelStarted = performance.now();

  for await (const part of opts.router.streamChat({
    model: opts.session.model,
    messages: toChatMessages(
      assembleSessionMessages(
        opts.session,
        opts.skillLoadPaths,
        opts.skillsConfig,
        opts.promptLayers,
        opts.prune,
      ),
    ),
    tools: opts.tools,
  })) {
    if (part.type === "text-delta") {
      text += part.text;
      yield {
        type: "message.delta",
        sessionId: opts.session.id,
        messageId: opts.messageId,
        delta: part.text,
      };
    } else if (part.type === "tool-call") {
      toolCalls.push({
        id: part.id,
        name: part.name,
        arguments: part.arguments,
      });
    } else if (part.type === "usage") {
      inputTokens = part.inputTokens;
      outputTokens = part.outputTokens;
      cacheReadTokens = part.cacheReadTokens ?? 0;
      cacheWriteTokens = part.cacheWriteTokens ?? 0;
    } else if (part.type === "error") {
      return { kind: "error", message: part.message };
    }
  }

  opts.observability?.recordModelLatency?.(
    (performance.now() - modelStarted) / 1000,
  );

  return {
    kind: "ok",
    text,
    toolCalls,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

function appendSystemNote(session: StoredSession, note: string): void {
  if (!session.systemNotes) session.systemNotes = [];
  session.systemNotes.push(note);
}

function cloneSessionForSubagent(parent: StoredSession): StoredSession {
  return {
    ...parent,
    planJson: parent.planJson ? [...parent.planJson] : null,
    activeSkills: parent.activeSkills
      ? parent.activeSkills.map((skill) => ({ ...skill }))
      : undefined,
    systemNotes: parent.systemNotes ? [...parent.systemNotes] : undefined,
    compactions: parent.compactions
      ? parent.compactions.map((entry) => ({ ...entry }))
      : undefined,
    usage: { inputTokens: 0, outputTokens: 0 },
    messages: [],
    status: "idle",
  };
}

function remapSubagentEventForParent(
  event: ZoxEvent,
  parentSessionId: string,
): ZoxEvent {
  if (!("sessionId" in event) || event.sessionId === parentSessionId) {
    return event;
  }
  return { ...event, sessionId: parentSessionId };
}

async function* iterSubagentTurn(opts: {
  session: StoredSession;
  userContent: string;
  router: TurnRouter;
  tools: ToolRegistry;
  permission?: PermissionResponder;
  hooks?: HookRunner;
  judge?: PromptJudge;
  skipJudge?: boolean;
  context?: ContextEngine;
  overflowThreshold?: number;
  prune?: PruneOptions;
  observability?: TurnObservability;
  skillLoadPaths?: string[];
  webfetchAllowedHosts?: string[];
  webfetchMaxBytes?: number;
  remoteExec?: import("@zox/tools").ToolContext["remoteExec"];
  sandboxEnvAllowlist?: string[];
  sandboxAllowHosts?: string[];
  memoryDb?: import("bun:sqlite").Database;
  skillsConfig?: CatalogOptions;
  instructionFiles?: string[];
  preCompactTokenThreshold?: number;
  onFileMutate?: (path: string) => Promise<void>;
  afterFileMutate?: (path: string) => Promise<string | undefined>;
  ids?: {
    messageId(): string;
    turnId(): string;
    toolCallId(): string;
    requestId(): string;
  };
  child: StoredSession;
  parent: StoredSession;
}): AsyncGenerator<ZoxEvent, { ok: boolean; text: string }> {
  let text = "";
  let completed = false;
  let permissionPending = false;
  for await (const event of runTurn({
    session: opts.child,
    userContent: opts.userContent,
    router: opts.router,
    tools: opts.tools,
    permission: opts.permission,
    hooks: opts.hooks,
    judge: opts.judge,
    skipJudge: true,
    context: opts.context,
    overflowThreshold: opts.overflowThreshold,
    prune: opts.prune,
    observability: opts.observability,
    skillLoadPaths: opts.skillLoadPaths,
    webfetchAllowedHosts: opts.webfetchAllowedHosts,
    webfetchMaxBytes: opts.webfetchMaxBytes,
    remoteExec: opts.remoteExec,
    sandboxEnvAllowlist: opts.sandboxEnvAllowlist,
    sandboxAllowHosts: opts.sandboxAllowHosts,
    memoryDb: opts.memoryDb,
    skillsConfig: opts.skillsConfig,
    instructionFiles: opts.instructionFiles,
    preCompactTokenThreshold: opts.preCompactTokenThreshold,
    onFileMutate: opts.onFileMutate,
    afterFileMutate: opts.afterFileMutate,
    ids: opts.ids,
  })) {
    if (event.type === "message.completed") {
      text = event.content;
      completed = true;
    } else if (event.type === "error") {
      text = event.message;
    }
    if (event.type === "tool.permission_required") {
      yield remapSubagentEventForParent(event, opts.parent.id);
    } else if (
      event.type === "session.status" &&
      event.status === "awaiting_permission"
    ) {
      permissionPending = true;
      opts.parent.status = "awaiting_permission";
      yield remapSubagentEventForParent(event, opts.parent.id);
    } else if (
      event.type === "session.status" &&
      event.status === "running" &&
      permissionPending
    ) {
      permissionPending = false;
      opts.parent.status = "running";
      yield remapSubagentEventForParent(event, opts.parent.id);
    }
  }
  opts.parent.usage.inputTokens += opts.child.usage.inputTokens;
  opts.parent.usage.outputTokens += opts.child.usage.outputTokens;
  return { ok: completed, text };
}

async function* executeToolCall(input: {
  call: ToolCall;
  opts: {
    session: StoredSession;
    router: TurnRouter;
    tools: ToolRegistry;
    permission?: PermissionResponder;
    hooks?: HookRunner;
    judge?: PromptJudge;
    skipJudge?: boolean;
    context?: ContextEngine;
    overflowThreshold?: number;
    prune?: PruneOptions;
    onOverflow?: (info: {
      kind: "auto";
      estimatedTokens: number;
    }) => Promise<void> | AsyncIterable<ZoxEvent>;
    observability?: TurnObservability;
    skillLoadPaths?: string[];
    webfetchAllowedHosts?: string[];
    webfetchMaxBytes?: number;
    remoteExec?: import("@zox/tools").ToolContext["remoteExec"];
    sandboxEnvAllowlist?: string[];
    sandboxAllowHosts?: string[];
    memoryDb?: import("bun:sqlite").Database;
    skillsConfig?: CatalogOptions;
    instructionFiles?: string[];
    preCompactTokenThreshold?: number;
    onFileMutate?: (path: string) => Promise<void>;
    afterFileMutate?: (path: string) => Promise<string | undefined>;
    ids?: {
      messageId(): string;
      turnId(): string;
      toolCallId(): string;
      requestId(): string;
    };
  };
  profileTools: string[];
  ruleset: ReturnType<typeof getAgentProfile>["ruleset"];
}): AsyncIterable<ZoxEvent> {
  const { call, opts, profileTools, ruleset } = input;
  const toolCallId = call.id || opts.ids?.toolCallId() || createId("tc");
  yield {
    type: "tool.started",
    sessionId: opts.session.id,
    toolCallId,
    name: call.name,
    arguments: call.arguments,
  };

  let result: ToolResult;
  if (!toolMatchesProfile(profileTools, call.name)) {
    result = {
      ok: false,
      content: "Permission denied",
      truncated: false,
    };
  } else {
    const subject = permissionSubject(call.name, call.arguments);
    let decision = evaluatePermission(ruleset, call.name, subject);
    if (decision === "ask") {
      const requestId = opts.ids?.requestId() ?? createId("req");
      opts.session.status = "awaiting_permission";
      yield {
        type: "session.status",
        sessionId: opts.session.id,
        status: "awaiting_permission",
      };
      yield {
        type: "tool.permission_required",
        sessionId: opts.session.id,
        requestId,
        toolCallId,
        name: call.name,
        arguments: call.arguments,
      };
      await opts.hooks?.run("PermissionRequest", {
        matcher: call.name,
        tool: { name: call.name, arguments: call.arguments },
        session: {
          id: opts.session.id,
          workspaceRoot: opts.session.workspaceRoot,
        },
      });
      const approved = opts.permission
        ? await opts.permission.wait(requestId)
        : false;
      opts.session.status = "running";
      yield {
        type: "session.status",
        sessionId: opts.session.id,
        status: "running",
      };
      decision = approved ? "allow" : "deny";
      if (decision === "deny") {
        await opts.hooks?.run("PermissionDenied", {
          matcher: call.name,
          tool: { name: call.name, arguments: call.arguments },
          session: {
            id: opts.session.id,
            workspaceRoot: opts.session.workspaceRoot,
          },
        });
      }
    }
    if (decision !== "allow") {
      result = {
        ok: false,
        content: "Permission denied",
        truncated: false,
      };
    } else {
      let args = call.arguments;
      if (opts.hooks) {
        const pre = await opts.hooks.run("PreToolUse", {
          tool: { name: call.name, arguments: args },
          session: {
            id: opts.session.id,
            workspaceRoot: opts.session.workspaceRoot,
          },
        });
        if (pre.decision === "deny") {
          result = {
            ok: false,
            content: "Permission denied",
            truncated: false,
          };
          opts.observability?.recordTool(call.name, true);
          opts.session.messages.push({
            id: createId("msg"),
            role: "tool",
            toolCallId,
            name: call.name,
            content: result.content,
          });
          yield {
            type: "tool.completed",
            sessionId: opts.session.id,
            toolCallId,
            name: call.name,
            ok: false,
          };
          return;
        }
        if (pre.updatedInput) args = pre.updatedInput;
      }

      const tool = opts.tools.get(call.name);
      if (!tool) {
        result = {
          ok: false,
          content: "Unknown tool",
          truncated: false,
        };
      } else if (call.name === "task") {
        const prompt = args.prompt;
        const agent =
          args.agent === "build" || args.agent === "plan" ? args.agent : "plan";
        if (typeof prompt !== "string" || prompt.length === 0) {
          result = {
            ok: false,
            content: "Invalid arguments for task",
            truncated: false,
          };
        } else {
          await opts.hooks?.run("SubagentStart", {
            matcher: "task",
            session: {
              id: opts.session.id,
              workspaceRoot: opts.session.workspaceRoot,
            },
            prompt,
          });
          const child: StoredSession = {
            ...cloneSessionForSubagent(opts.session),
            id: createId("sess"),
            agent,
            messages: [],
            status: "idle",
          };
          const childTools = opts.tools.without("task");
          const sub = yield* iterSubagentTurn({
            ...opts,
            child,
            parent: opts.session,
            userContent: prompt,
            tools: childTools,
          });
          await opts.hooks?.run("SubagentStop", {
            matcher: "task",
            session: {
              id: opts.session.id,
              workspaceRoot: opts.session.workspaceRoot,
            },
          });
          const content =
            sub.text.length > MAX_TOOL_OUTPUT_CHARS
              ? sub.text.slice(0, MAX_TOOL_OUTPUT_CHARS)
              : sub.text;
          result = {
            ok: sub.ok,
            content,
            truncated: sub.text.length > MAX_TOOL_OUTPUT_CHARS,
          };
        }
      } else {
        const runTool = () =>
          tool.execute(args, {
            sandboxRoot: opts.session.sandboxRoot,
            maxToolOutputChars: MAX_TOOL_OUTPUT_CHARS,
            session: {
              id: opts.session.id,
              workspaceRoot: opts.session.workspaceRoot,
              agent: opts.session.agent,
              sandboxMode: opts.session.sandboxMode,
            },
            parentSession: opts.session,
            loadPaths: opts.skillLoadPaths,
            allowedHosts: opts.webfetchAllowedHosts,
            webfetchMaxBytes: opts.webfetchMaxBytes,
            remoteExec: opts.remoteExec,
            sandboxEnvAllowlist: opts.sandboxEnvAllowlist,
            sandboxAllowHosts: opts.sandboxAllowHosts,
            memoryDb: opts.memoryDb,
            onFileMutate: opts.onFileMutate,
            afterFileMutate: opts.afterFileMutate,
            activateSkill: (skill) => {
              opts.session.activeSkills = activateSkill(
                opts.session.activeSkills ?? [],
                skill,
              );
              void opts.hooks?.run("InstructionsLoaded", {
                session: {
                  id: opts.session.id,
                  workspaceRoot: opts.session.workspaceRoot,
                },
                skills: [{ name: skill.name, path: skill.path }],
              });
              opts.observability?.recordSkillLoad?.("tool");
            },
          });
        result = opts.observability?.withTool
          ? await opts.observability.withTool(call.name, runTool)
          : await runTool();
        if (result.content.length > MAX_TOOL_OUTPUT_CHARS) {
          result = {
            ...result,
            content: result.content.slice(0, MAX_TOOL_OUTPUT_CHARS),
            truncated: true,
          };
        }
        if (call.name === "todowrite" && result.ok) {
          opts.session.planJson = parsePlan(args.items);
        }
      }

      if (opts.hooks) {
        await opts.hooks.run("PostToolUse", {
          tool: { name: call.name, arguments: args },
          session: {
            id: opts.session.id,
            workspaceRoot: opts.session.workspaceRoot,
          },
        });
        if (!result.ok) {
          await opts.hooks.run("PostToolUseFailure", {
            matcher: call.name,
            tool: { name: call.name, arguments: args },
            session: {
              id: opts.session.id,
              workspaceRoot: opts.session.workspaceRoot,
            },
          });
        }
      }
    }
  }

  opts.observability?.recordTool(
    call.name,
    !result.ok && result.content === "Permission denied",
  );
  opts.session.messages.push({
    id: createId("msg"),
    role: "tool",
    toolCallId,
    name: call.name,
    content: result.content,
  });
  yield {
    type: "tool.completed",
    sessionId: opts.session.id,
    toolCallId,
    name: call.name,
    ok: result.ok,
  };
}

function permissionSubject(
  name: string,
  args: Record<string, unknown>,
): string | undefined {
  if (name === "bash" && typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  return undefined;
}

function toChatMessages(messages: StoredMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        toolCallId: message.toolCallId ?? "",
        name: message.name ?? "",
        content: message.content,
      };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function splitProvider(modelRef: string): { providerId: string } {
  const slash = modelRef.indexOf("/");
  return { providerId: slash === -1 ? modelRef : modelRef.slice(0, slash) };
}
