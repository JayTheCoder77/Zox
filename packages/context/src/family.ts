import PROMPT_ANTHROPIC from "./prompts/anthropic.txt" with { type: "text" };
import PROMPT_DEFAULT from "./prompts/default.txt" with { type: "text" };
import PROMPT_GEMINI from "./prompts/gemini.txt" with { type: "text" };
import PROMPT_OPENAI from "./prompts/openai.txt" with { type: "text" };

export function selectFamilyPrompt(modelRef: string): string {
  const haystack = modelRef.toLowerCase();
  if (haystack.includes("claude")) return PROMPT_ANTHROPIC;
  if (haystack.includes("gemini-")) return PROMPT_GEMINI;
  if (
    haystack.includes("gpt") ||
    haystack.includes("o1") ||
    haystack.includes("o3")
  ) {
    return PROMPT_OPENAI;
  }
  return PROMPT_DEFAULT;
}
