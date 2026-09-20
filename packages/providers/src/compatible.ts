import { createOpenAI } from "@ai-sdk/openai";
import { jsonSchema, type ModelMessage, streamText, tool } from "ai";
import type {
  ChatMessage,
  ProviderAdapter,
  StreamChatParams,
  StreamEvent,
  ToolSchema,
} from "./types.ts";

export type OpenAICompatibleAdapterOptions = {
  id: string;
  apiKey: string;
  baseURL?: string;
  streamChatImpl?: (params: StreamChatParams) => AsyncIterable<StreamEvent>;
};

export function createOpenAICompatibleAdapter(
  options: OpenAICompatibleAdapterOptions,
): ProviderAdapter {
  const client = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  });
  return {
    id: options.id,
    streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      if (options.streamChatImpl) {
        return options.streamChatImpl(params);
      }
      return streamLanguageModelToEvents(params, (modelId) => client(modelId));
    },
  };
}

function toolsFromSchemas(schemas?: ToolSchema[]) {
  if (!schemas?.length) {
    return undefined;
  }
  return Object.fromEntries(
    schemas.map((schema) => [
      schema.name,
      tool({
        description: schema.description,
        inputSchema: jsonSchema(schema.parameters),
      }),
    ]),
  );
}

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.name,
            output: { type: "text", value: message.content },
          },
        ],
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(message.content
            ? [{ type: "text" as const, text: message.content }]
            : []),
          ...message.toolCalls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.name,
            input: call.arguments,
          })),
        ],
      };
    }
    return { role: message.role, content: message.content };
  });
}

export function toStreamTextPrompt(messages: ChatMessage[]): {
  instructions?: Array<{ role: "system"; content: string }>;
  messages: ModelMessage[];
} {
  const modelMessages = toModelMessages(messages);
  const instructions = modelMessages.filter(
    (message): message is { role: "system"; content: string } =>
      message.role === "system",
  );
  const rest = modelMessages.filter((message) => message.role !== "system");
  return {
    instructions: instructions.length > 0 ? instructions : undefined,
    messages: rest,
  };
}

export async function* streamLanguageModelToEvents(
  params: StreamChatParams,
  resolveModel: (
    modelId: string,
  ) => ReturnType<ReturnType<typeof createOpenAI>>,
): AsyncIterable<StreamEvent> {
  const prompt = toStreamTextPrompt(params.messages);
  const result = streamText({
    model: resolveModel(params.model),
    instructions: prompt.instructions,
    messages: prompt.messages,
    tools: toolsFromSchemas(params.tools),
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
      if (text) {
        yield { type: "text-delta", text };
      }
    } else if (part.type === "tool-call") {
      const call = part as Record<string, unknown>;
      const id = typeof call.toolCallId === "string" ? call.toolCallId : "";
      const name = typeof call.toolName === "string" ? call.toolName : "";
      const input = call.input;
      const args =
        input !== null && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      yield { type: "tool-call", id, name, arguments: args };
    } else if (part.type === "finish") {
      const usageEvent = usageFromLanguageModelUsage(part);
      if (usageEvent) {
        yield usageEvent;
      }
    } else if (part.type === "error") {
      const message =
        "error" in part ? String(part.error) : "Provider stream error";
      yield { type: "error", message };
    }
  }
  yield { type: "done" };
}

function usageFromLanguageModelUsage(
  part: Record<string, unknown>,
): StreamEvent | null {
  const usage =
    "totalUsage" in part
      ? part.totalUsage
      : "usage" in part
        ? part.usage
        : undefined;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const record = usage as Record<string, unknown>;
  const inputTokens = Number(record.inputTokens ?? 0);
  const outputTokens = Number(record.outputTokens ?? 0);
  const event: StreamEvent = {
    type: "usage",
    inputTokens,
    outputTokens,
  };
  const details = record.inputTokenDetails;
  if (details && typeof details === "object") {
    const tokenDetails = details as Record<string, unknown>;
    if (typeof tokenDetails.cacheReadTokens === "number") {
      event.cacheReadTokens = tokenDetails.cacheReadTokens;
    }
    if (typeof tokenDetails.cacheWriteTokens === "number") {
      event.cacheWriteTokens = tokenDetails.cacheWriteTokens;
    }
  }
  return event;
}
