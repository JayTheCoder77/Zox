import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = join(import.meta.dir, "prompts");

const PROMPT_ANTHROPIC = readFileSync(
  join(PROMPTS_DIR, "anthropic.txt"),
  "utf8",
);
const PROMPT_OPENAI = readFileSync(join(PROMPTS_DIR, "openai.txt"), "utf8");
const PROMPT_GEMINI = readFileSync(join(PROMPTS_DIR, "gemini.txt"), "utf8");
const PROMPT_DEFAULT = readFileSync(join(PROMPTS_DIR, "default.txt"), "utf8");

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
