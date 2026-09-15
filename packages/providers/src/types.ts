export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type StreamChatParams = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  abortSignal?: AbortSignal;
};

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | {
      type: "tool-call";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ProviderAdapter {
  id: string;
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
}
