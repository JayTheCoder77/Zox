import { describe, expect, test } from "bun:test";
import { createMockAdapter } from "./mock.ts";
import type { StreamEvent } from "./types.ts";

async function collect(
  iter: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
  const items = [];
  for await (const item of iter) items.push(item);
  return items;
}

describe("createMockAdapter", () => {
  test("streams the last user message as text-delta then usage and done", async () => {
    const adapter = createMockAdapter();
    expect(adapter.id).toBe("mock");
    const events = await collect(
      adapter.streamChat({
        model: "echo",
        messages: [{ role: "user", content: "ping" }],
      }),
    );
    expect(events).toEqual([
      { type: "text-delta", text: "ping" },
      { type: "usage", inputTokens: 1, outputTokens: 1 },
      { type: "done" },
    ]);
  });
});
