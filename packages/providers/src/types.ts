export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamChatParams = {
  model: string;
  messages: ChatMessage[];
  abortSignal?: AbortSignal;
};

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ProviderAdapter {
  id: string;
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
}
