import { describe, expect, test } from "bun:test";
import { selectFamilyPrompt } from "./family.ts";

describe("selectFamilyPrompt", () => {
  test("selects anthropic for Claude model ids including OpenRouter", () => {
    const prompt = selectFamilyPrompt("openrouter/anthropic/claude-3.5-sonnet");
    expect(prompt).toContain("Zox family: anthropic");
    expect(prompt).toContain("Prefer a short plan before the first edit");
    expect(selectFamilyPrompt("anthropic/claude-sonnet-4-20250514")).toContain(
      "Zox family: anthropic",
    );
  });

  test("selects openai for GPT and o-series model ids", () => {
    const gpt = selectFamilyPrompt("openai/gpt-4.1");
    expect(gpt).toContain("Zox family: openai");
    expect(gpt).toContain("Do not narrate tool calls");
    expect(selectFamilyPrompt("openai/o3-mini")).toContain(
      "Zox family: openai",
    );
    expect(selectFamilyPrompt("openai/gpt-5")).toContain("Zox family: openai");
  });

  test("selects gemini for Gemini model ids", () => {
    const gemini = selectFamilyPrompt("google/gemini-2.5-pro");
    expect(gemini).toContain("Zox family: gemini");
    expect(gemini).toContain(
      "One tool step at a time when the next step depends on the result",
    );
  });

  test("selects default for Groq Llama and unknown ids", () => {
    const groq = selectFamilyPrompt("groq/llama-3.3-70b-versatile");
    expect(groq).toContain("Zox family: default");
    expect(groq).toContain(
      "If you are unsure a file exists, use glob or ls before read",
    );
    expect(selectFamilyPrompt("mock/echo")).toContain("Zox family: default");
  });
});
