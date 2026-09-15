import type { ZoxEvent } from "@zox/contracts";
import type { StreamChatParams, StreamEvent } from "@zox/providers";
import { createId } from "./ids.ts";
import type { StoredSession } from "./store.ts";

export type TurnRouter = {
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
};

export async function* runTurn(opts: {
  session: StoredSession;
  userContent: string;
  router: TurnRouter;
  ids?: { messageId(): string; turnId(): string };
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

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  const started = Date.now();

  try {
    for await (const part of opts.router.streamChat({
      model: opts.session.model,
      messages: opts.session.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })) {
      if (part.type === "text-delta") {
        text += part.text;
        yield {
          type: "message.delta",
          sessionId: opts.session.id,
          messageId,
          delta: part.text,
        };
      } else if (part.type === "usage") {
        sawUsage = true;
        inputTokens = part.inputTokens;
        outputTokens = part.outputTokens;
      } else if (part.type === "error") {
        opts.session.status = "error";
        yield {
          type: "error",
          sessionId: opts.session.id,
          message: part.message,
        };
        yield {
          type: "session.status",
          sessionId: opts.session.id,
          status: "error",
        };
        return;
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
    inputTokens: sawUsage ? inputTokens : 0,
    outputTokens: sawUsage ? outputTokens : 0,
    durationMs: Date.now() - started,
  };

  opts.session.messages.push({
    id: messageId,
    role: "assistant",
    content: text,
  });
  opts.session.status = "idle";
  yield {
    type: "message.completed",
    sessionId: opts.session.id,
    messageId,
    role: "assistant",
    content: text,
  };
  yield {
    type: "session.status",
    sessionId: opts.session.id,
    status: "idle",
  };
}

function splitProvider(modelRef: string): { providerId: string } {
  const slash = modelRef.indexOf("/");
  return { providerId: slash === -1 ? modelRef : modelRef.slice(0, slash) };
}
