import { describe, expect, test } from "bun:test";
import { lookupContextWindow } from "./catalog.ts";

describe("lookupContextWindow", () => {
  test("resolves openai gpt-4.1", () => {
    expect(lookupContextWindow("openai/gpt-4.1")).toBe(1_047_576);
  });

  test("resolves openrouter-prefixed model ids", () => {
    expect(lookupContextWindow("openrouter/openai/gpt-4.1")).toBe(1_047_576);
  });

  test("does not confuse gpt-4o with gpt-4.1", () => {
    expect(lookupContextWindow("openai/gpt-4o")).toBe(128_000);
  });

  test("keeps dated Claude 4 sonnet at 200k, not the 1M sonnet-4 family", () => {
    expect(lookupContextWindow("anthropic/claude-sonnet-4-20250514")).toBe(
      200_000,
    );
    expect(lookupContextWindow("anthropic/claude-sonnet-4")).toBe(1_000_000);
  });

  test("returns undefined for unknown models", () => {
    expect(lookupContextWindow("mock/echo")).toBeUndefined();
    expect(lookupContextWindow("unknown/not-a-real-model")).toBeUndefined();
  });
});
