import { describe, expect, test } from "bun:test";
import { assembleProviderMessages } from "./assemble.ts";
import { compactSession, TOOL_OUTPUT_MAX_CHARS } from "./compact.ts";

const fourMessages = () => [
  { id: "m1", role: "user", content: "first" },
  { id: "m2", role: "assistant", content: "reply" },
  { id: "m3", role: "tool", content: "x".repeat(3000) },
  { id: "m4", role: "user", content: "last goal" },
];

describe("compactSession", () => {
  test("keeps full history; fake summarize yields SUM", async () => {
    const messages = fourMessages();
    let prompt = "";
    const { messages: out, compact } = await compactSession({
      messages,
      planJson: { step: 1 },
      summarize: async (p) => {
        prompt = p;
        return "SUM";
      },
    });
    expect(out).toHaveLength(4);
    expect(out).toEqual(messages);
    expect(compact.summary).toBe("SUM");
    expect(compact.fromMessageId).toBe("m1");
    expect(compact.toMessageId).toBe("m3");
    expect(prompt).toContain("last goal");
    expect(prompt).toContain('"step":1');
    expect(prompt).toContain("x".repeat(TOOL_OUTPUT_MAX_CHARS));
    expect(prompt).not.toContain("x".repeat(TOOL_OUTPUT_MAX_CHARS + 1));
  });
});

describe("assembleProviderMessages", () => {
  test("provider view length 2 after compact of 4 messages", async () => {
    const messages = fourMessages();
    const { compact } = await compactSession({
      messages,
      summarize: async () => "SUM",
    });
    const provider = assembleProviderMessages({
      messages,
      compactions: [compact],
    });
    expect(messages).toHaveLength(4);
    expect(provider).toHaveLength(2);
    expect(provider[0]).toMatchObject({
      role: "assistant",
      content: "SUM",
      meta: { summary: true },
    });
    expect(provider[1]).toMatchObject({ id: "m4", role: "user" });
  });

  test("no compactions returns all messages", () => {
    const messages = fourMessages();
    expect(assembleProviderMessages({ messages, compactions: [] })).toEqual(
      messages,
    );
  });
});
