import { describe, expect, test } from "bun:test";
import { createAnthropicAdapter } from "./anthropic.ts";
import type { StreamEvent } from "./types.ts";

describe("createAnthropicAdapter", () => {
  test("uses the anthropic id and injected stream implementation", async () => {
    async function* fakeStream(): AsyncIterable<StreamEvent> {
      yield { type: "text-delta", text: "ok" };
      yield { type: "done" };
    }

    const adapter = createAnthropicAdapter({
      apiKey: "test-key",
      streamChatImpl: fakeStream,
    });

    expect(adapter.id).toBe("anthropic");
    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "text-delta", text: "ok" },
      { type: "done" },
    ]);
  });
});
