import { describe, expect, test } from "bun:test";
import { createOpenAICompatibleAdapter } from "./compatible.ts";
import type { StreamEvent } from "./types.ts";

describe("createOpenAICompatibleAdapter", () => {
  test("uses the provided id and injected stream implementation", async () => {
    async function* fakeStream(): AsyncIterable<StreamEvent> {
      yield {
        type: "tool-call",
        id: "call-1",
        name: "read",
        arguments: { path: "src/index.ts" },
      };
      yield { type: "done" };
    }

    const adapter = createOpenAICompatibleAdapter({
      id: "openrouter",
      apiKey: "test-key",
      streamChatImpl: fakeStream,
    });

    expect(adapter.id).toBe("openrouter");
    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat({
      model: "anthropic/claude-3.5-sonnet",
      messages: [{ role: "user", content: "inspect" }],
    })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({ type: "tool-call", name: "read" });
  });
});
