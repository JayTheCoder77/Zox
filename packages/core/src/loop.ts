import { assembleProviderMessages, estimateSession } from "@zox/context";
import type { ZoxEvent } from "@zox/contracts";
import type {
  ChatMessage,
  StreamChatParams,
  StreamEvent,
  ToolCall,
} from "@zox/providers";
import type { ToolRegistry, ToolResult } from "@zox/tools";
import { getAgentProfile } from "./agents.ts";
import { createId } from "./ids.ts";
import { evaluatePermission } from "./permissions.ts";
import type { StoredMessage, StoredSession } from "./store.ts";

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

export async function* runTurn(opts: {
  session: StoredSession;
  userContent: string;
  router: TurnRouter;
  tools: ToolRegistry;
  permission?: PermissionResponder;
  hooks?: HookRunner;
  context?: ContextEngine;
  ids?: {
    messageId(): string;
    turnId(): string;
    toolCallId(): string;
    requestId(): string;
  };
}): AsyncIterable<ZoxEvent> {
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
  }

  yield* emitContextWarnings(opts.session, opts.context);

  const profile = getAgentProfile(opts.session.agent);
  const toolSchemas = opts.tools
    .list()
    .filter((tool) => profile.tools.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

  let finalText = "";
  let inputTokens = 0;
  let outputTokens = 0;
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
  yield {
    type: "usage.turn",
    sessionId: opts.session.id,
    turnId,
    provider: providerId,
    model: opts.session.model,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - started,
  };

  opts.session.usage.inputTokens += inputTokens;
  opts.session.usage.outputTokens += outputTokens;
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

async function* emitContextWarnings(
  session: StoredSession,
  context?: ContextEngine,
): AsyncIterable<ZoxEvent> {
  const estimated = context?.estimateTokens
    ? context.estimateTokens(
        session.messages.map((message) => message.content).join(""),
      )
    : estimateSession(session.messages);
  const knownWindow = context?.windowTokens;
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
    if (estimated > UNKNOWN_WINDOW_TOKENS * UNKNOWN_OVERFLOW_RATIO) {
      yield {
        type: "context.overflow",
        sessionId: session.id,
        estimatedTokens: estimated,
      };
    }
    return;
  }
  if (estimated > knownWindow * KNOWN_OVERFLOW_RATIO) {
    yield {
      type: "context.overflow",
      sessionId: session.id,
      estimatedTokens: estimated,
    };
  }
}

type ModelRound =
  | {
      kind: "ok";
      text: string;
      toolCalls: ToolCall[];
      inputTokens: number;
      outputTokens: number;
    }
  | { kind: "error"; message: string };

async function* consumeModelRound(opts: {
  session: StoredSession;
  router: TurnRouter;
  messageId: string;
  tools?: StreamChatParams["tools"];
}): AsyncGenerator<ZoxEvent, ModelRound> {
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const toolCalls: ToolCall[] = [];

  for await (const part of opts.router.streamChat({
    model: opts.session.model,
    messages: toChatMessages(
      assembleProviderMessages({
        messages: opts.session.messages,
        compactions: opts.session.compactions,
      }),
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
    } else if (part.type === "error") {
      return { kind: "error", message: part.message };
    }
  }

  return {
    kind: "ok",
    text,
    toolCalls,
    inputTokens,
    outputTokens,
  };
}

async function* executeToolCall(input: {
  call: ToolCall;
  opts: {
    session: StoredSession;
    tools: ToolRegistry;
    permission?: PermissionResponder;
    hooks?: HookRunner;
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
  };

  let result: ToolResult;
  if (!profileTools.includes(call.name)) {
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
      };
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
      } else {
        result = await tool.execute(args, {
          sandboxRoot: opts.session.sandboxRoot,
          maxToolOutputChars: MAX_TOOL_OUTPUT_CHARS,
          session: {
            id: opts.session.id,
            workspaceRoot: opts.session.workspaceRoot,
            agent: opts.session.agent,
          },
        });
        if (result.content.length > MAX_TOOL_OUTPUT_CHARS) {
          result = {
            ...result,
            content: result.content.slice(0, MAX_TOOL_OUTPUT_CHARS),
            truncated: true,
          };
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
      }
    }
  }

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
