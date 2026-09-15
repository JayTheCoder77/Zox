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

  test("script can emit a tool-call then text on the next request", async () => {
    let request = 0;
    const adapter = createMockAdapter({
      script: async function* () {
        request += 1;
        if (request === 1) {
          yield {
            type: "tool-call",
            id: "c1",
            name: "read",
            arguments: { path: "a.ts" },
          };
          yield { type: "done" };
          return;
        }
        yield { type: "text-delta", text: "done" };
        yield { type: "done" };
      },
    });

    const first = await collect(
      adapter.streamChat({ model: "echo", messages: [] }),
    );
    expect(first[0]).toMatchObject({ type: "tool-call", name: "read" });

    const second = await collect(
      adapter.streamChat({ model: "echo", messages: [] }),
    );
    expect(second[0]).toEqual({ type: "text-delta", text: "done" });
  });
});
