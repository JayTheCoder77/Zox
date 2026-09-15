import { describe, expect, test } from "bun:test";
import { createMockAdapter } from "./mock.ts";
import { createProviderRouter, parseModelRef } from "./router.ts";

describe("parseModelRef", () => {
  test("splits provider/model", () => {
    expect(parseModelRef("openai/gpt-4.1")).toEqual({
      providerId: "openai",
      modelId: "gpt-4.1",
    });
  });

  test("keeps extra slashes in the model id", () => {
    expect(parseModelRef("openrouter/anthropic/claude-3.5-sonnet")).toEqual({
      providerId: "openrouter",
      modelId: "anthropic/claude-3.5-sonnet",
    });
  });
});

describe("createProviderRouter", () => {
  test("routes mock/echo to the mock adapter", async () => {
    const router = createProviderRouter({
      adapters: [createMockAdapter()],
    });
    const adapter = router.resolve("mock/echo");
    expect(adapter.id).toBe("mock");
    const events = [];
    for await (const event of router.streamChat({
      model: "mock/echo",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }
    expect(events[0]).toEqual({ type: "text-delta", text: "hi" });
  });

  test("throws on unknown provider", () => {
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    expect(() => router.resolve("missing/x")).toThrow(/unknown provider/i);
  });
});
