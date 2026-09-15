import { describe, expect, test } from "bun:test";
import { parseSseBlock } from "./sse.ts";

describe("parseSseBlock", () => {
  test("parses event and json data", () => {
    const event = parseSseBlock(
      `event: message.delta\ndata: {"type":"message.delta","sessionId":"s","messageId":"m","delta":"hi"}`,
    );
    expect(event).toMatchObject({ type: "message.delta", delta: "hi" });
  });
});
