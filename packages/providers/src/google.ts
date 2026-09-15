import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamLanguageModelToEvents } from "./compatible.ts";
import type { ProviderAdapter, StreamChatParams, StreamEvent } from "./types.ts";

export type GoogleAdapterOptions = {
  apiKey: string;
  streamChatImpl?: (params: StreamChatParams) => AsyncIterable<StreamEvent>;
};

export function createGoogleAdapter(options: GoogleAdapterOptions): ProviderAdapter {
  const client = createGoogleGenerativeAI({ apiKey: options.apiKey });
  return {
    id: "google",
    streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      if (options.streamChatImpl) {
        return options.streamChatImpl(params);
      }
      return streamLanguageModelToEvents(params, (modelId) => client(modelId));
    },
  };
}
