import { describe, expect, test } from "bun:test";
import { createOpenAIAdapter } from "./openai.ts";
import type { StreamEvent } from "./types.ts";

describe("createOpenAIAdapter", () => {
  test("maps injected stream chunks to StreamEvent", async () => {
    async function* fakeStream(): AsyncIterable<StreamEvent> {
      yield { type: "text-delta", text: "ok" };
      yield { type: "usage", inputTokens: 2, outputTokens: 1 };
      yield { type: "done" };
    }
    const adapter = createOpenAIAdapter({
      apiKey: "sk-test",
      streamChatImpl: fakeStream,
    });
    expect(adapter.id).toBe("openai");
    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "text-delta", text: "ok" },
      { type: "usage", inputTokens: 2, outputTokens: 1 },
      { type: "done" },
    ]);
  });
});
