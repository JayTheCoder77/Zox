import { describe, expect, test } from "bun:test";
import {
  createOpenAICompatibleAdapter,
  toStreamTextPrompt,
} from "./compatible.ts";
import type { StreamEvent } from "./types.ts";

describe("toStreamTextPrompt", () => {
  test("moves system messages into instructions for AI SDK 7", () => {
    const prompt = toStreamTextPrompt([
      { role: "system", content: "Zox family: anthropic" },
      { role: "system", content: "implement the issue" },
      { role: "user", content: "fix django" },
    ]);
    expect(prompt.instructions).toEqual([
      { role: "system", content: "Zox family: anthropic" },
      { role: "system", content: "implement the issue" },
    ]);
    expect(prompt.messages).toEqual([{ role: "user", content: "fix django" }]);
  });

  test("omits instructions when there are no system messages", () => {
    const prompt = toStreamTextPrompt([{ role: "user", content: "hi" }]);
    expect(prompt.instructions).toBeUndefined();
    expect(prompt.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

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
