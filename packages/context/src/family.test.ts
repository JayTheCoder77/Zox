import { describe, expect, test } from "bun:test";
import { selectFamilyPrompt } from "./family.ts";

describe("selectFamilyPrompt", () => {
  test("selects anthropic for Claude model ids including OpenRouter", () => {
    const prompt = selectFamilyPrompt("openrouter/anthropic/claude-3.5-sonnet");
    expect(prompt).toContain("Zox family: anthropic");
    expect(selectFamilyPrompt("anthropic/claude-sonnet-4-20250514")).toContain(
      "Zox family: anthropic",
    );
  });

  test("selects openai for GPT and o-series model ids", () => {
    expect(selectFamilyPrompt("openai/gpt-4.1")).toContain(
      "Zox family: openai",
    );
    expect(selectFamilyPrompt("openai/o3-mini")).toContain(
      "Zox family: openai",
    );
    expect(selectFamilyPrompt("openai/gpt-5")).toContain("Zox family: openai");
  });

  test("selects gemini for Gemini model ids", () => {
    expect(selectFamilyPrompt("google/gemini-2.5-pro")).toContain(
      "Zox family: gemini",
    );
  });

  test("selects default for Groq Llama and unknown ids", () => {
    expect(selectFamilyPrompt("groq/llama-3.3-70b-versatile")).toContain(
      "Zox family: default",
    );
    expect(selectFamilyPrompt("mock/echo")).toContain("Zox family: default");
  });
});
