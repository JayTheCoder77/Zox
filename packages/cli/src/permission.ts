import { createInterface } from "node:readline/promises";

export async function promptPermission(summary?: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const prompt = summary ? `Allow ${summary}? [y/n] ` : "Allow tool? [y/n] ";
    const answer = await rl.question(prompt);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}
