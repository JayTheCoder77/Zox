export const TOOL_OUTPUT_MAX_CHARS = 2000;

export type CompactResult = {
  fromMessageId: string;
  toMessageId: string;
  summary: string;
};

export type CompactMessage = {
  id: string;
  role: string;
  content: string;
};

export async function compactSession(opts: {
  messages: CompactMessage[];
  planJson?: unknown;
  activeSkillNames?: string[];
  summarize: (prompt: string) => Promise<string>;
}): Promise<{ messages: CompactMessage[]; compact: CompactResult }> {
  const lastUserIndex = findLastUserIndex(opts.messages);
  if (lastUserIndex <= 0) {
    throw new Error("Nothing to compact before the last user message");
  }

  const range = opts.messages.slice(0, lastUserIndex);
  const lastUser = opts.messages[lastUserIndex];
  const fromMessage = range[0];
  const toMessage = range[range.length - 1];
  if (!lastUser || !fromMessage || !toMessage) {
    throw new Error("Nothing to compact before the last user message");
  }
  const prompt = buildCompactionPrompt({
    range,
    lastUserGoal: lastUser.content,
    planJson: opts.planJson,
    activeSkillNames: opts.activeSkillNames,
  });
  const summary = await opts.summarize(prompt);

  return {
    messages: opts.messages,
    compact: {
      fromMessageId: fromMessage.id,
      toMessageId: toMessage.id,
      summary,
    },
  };
}

function findLastUserIndex(messages: CompactMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user") return i;
  }
  return -1;
}

function buildCompactionPrompt(input: {
  range: CompactMessage[];
  lastUserGoal: string;
  planJson?: unknown;
  activeSkillNames?: string[];
}): string {
  const lines: string[] = [
    "Summarize the conversation transcript below for continuation.",
    "",
    `Last user goal: ${input.lastUserGoal}`,
  ];
  if (input.planJson !== undefined) {
    lines.push("", `Plan JSON: ${JSON.stringify(input.planJson)}`);
  }
  if (input.activeSkillNames?.length) {
    lines.push("", `Active skills: ${input.activeSkillNames.join(", ")}`);
  }
  lines.push("", "Transcript:");
  for (const message of input.range) {
    const body =
      message.role === "tool"
        ? truncate(message.content, TOOL_OUTPUT_MAX_CHARS)
        : message.content;
    lines.push(`[${message.role}] ${body}`);
  }
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}
