import { describe, expect, test } from "bun:test";
import { createGoogleAdapter } from "./google.ts";
import type { StreamEvent } from "./types.ts";

describe("createGoogleAdapter", () => {
  test("uses the google id and injected stream implementation", async () => {
    async function* fakeStream(): AsyncIterable<StreamEvent> {
      yield { type: "text-delta", text: "ok" };
      yield { type: "done" };
    }

    const adapter = createGoogleAdapter({
      apiKey: "test-key",
      streamChatImpl: fakeStream,
    });

    expect(adapter.id).toBe("google");
    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat({
      model: "gemini-2.5-pro",
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
