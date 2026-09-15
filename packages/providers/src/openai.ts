import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type {
  ProviderAdapter,
  StreamChatParams,
  StreamEvent,
} from "./types.ts";

export type OpenAIAdapterOptions = {
  apiKey: string;
  streamChatImpl?: (params: StreamChatParams) => AsyncIterable<StreamEvent>;
};

export function createOpenAIAdapter(
  options: OpenAIAdapterOptions,
): ProviderAdapter {
  return {
    id: "openai",
    streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      if (options.streamChatImpl) {
        return options.streamChatImpl(params);
      }
      return streamViaAiSdk(params, options.apiKey);
    },
  };
}

async function* streamViaAiSdk(
  params: StreamChatParams,
  apiKey: string,
): AsyncIterable<StreamEvent> {
  const client = createOpenAI({ apiKey });
  const result = streamText({
    model: client(params.model),
    messages: params.messages,
    abortSignal: params.abortSignal,
  });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      const text =
        "text" in part && typeof part.text === "string"
          ? part.text
          : "delta" in part && typeof part.delta === "string"
            ? part.delta
            : "";
      if (text) yield { type: "text-delta", text };
    } else if (part.type === "finish") {
      const finish = part as Record<string, unknown>;
      const usage =
        "totalUsage" in finish
          ? finish.totalUsage
          : "usage" in finish
            ? finish.usage
            : undefined;
      const inputTokens =
        usage && typeof usage === "object" && "inputTokens" in usage
          ? Number(usage.inputTokens ?? 0)
          : 0;
      const outputTokens =
        usage && typeof usage === "object" && "outputTokens" in usage
          ? Number(usage.outputTokens ?? 0)
          : 0;
      yield { type: "usage", inputTokens, outputTokens };
    } else if (part.type === "error") {
      const message =
        "error" in part ? String(part.error) : "OpenAI stream error";
      yield { type: "error", message };
    }
  }
  yield { type: "done" };
}
