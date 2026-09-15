import type { ProviderAdapter } from "./types.ts";
import {
  createOpenAICompatibleAdapter,
  type OpenAICompatibleAdapterOptions,
} from "./compatible.ts";

export type OpenAIAdapterOptions = {
  apiKey: string;
  streamChatImpl?: OpenAICompatibleAdapterOptions["streamChatImpl"];
};

export function createOpenAIAdapter(options: OpenAIAdapterOptions): ProviderAdapter {
  return createOpenAICompatibleAdapter({
    id: "openai",
    apiKey: options.apiKey,
    streamChatImpl: options.streamChatImpl,
  });
}
