import type {
  ProviderAdapter,
  StreamChatParams,
  StreamEvent,
} from "./types.ts";

export type MockAdapterOptions = {
  script?: (
    params: StreamChatParams,
  ) => AsyncIterable<StreamEvent> | StreamEvent[];
};

export function createMockAdapter(
  options: MockAdapterOptions = {},
): ProviderAdapter {
  return {
    id: "mock",
    async *streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      if (options.script) {
        yield* options.script(params);
        return;
      }
      const lastUser = [...params.messages]
        .reverse()
        .find((message) => message.role === "user");
      const text = lastUser?.content ?? "";
      yield { type: "text-delta", text };
      yield { type: "usage", inputTokens: 1, outputTokens: 1 };
      yield { type: "done" };
    },
  };
}
