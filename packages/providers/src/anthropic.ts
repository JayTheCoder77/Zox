import { createAnthropic } from "@ai-sdk/anthropic";
import { streamLanguageModelToEvents } from "./compatible.ts";
import type { ProviderAdapter, StreamChatParams, StreamEvent } from "./types.ts";

export type AnthropicAdapterOptions = {
  apiKey: string;
  streamChatImpl?: (params: StreamChatParams) => AsyncIterable<StreamEvent>;
};

export function createAnthropicAdapter(
  options: AnthropicAdapterOptions,
): ProviderAdapter {
  const client = createAnthropic({ apiKey: options.apiKey });
  return {
    id: "anthropic",
    streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      if (options.streamChatImpl) {
        return options.streamChatImpl(params);
      }
      return streamLanguageModelToEvents(params, (modelId) => client(modelId));
    },
  };
}
