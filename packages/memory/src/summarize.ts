import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const AUTO_DIR = ".zox/memory/auto";
const INDEX_FILE = "index.json";

type IndexEntry = {
  sessionId: string;
  path: string;
  createdAt: string;
};

export async function autoSummarize(opts: {
  enabled: boolean;
  workspaceRoot: string;
  sessionId: string;
  planJson: unknown;
  recentTexts: string[];
  summarize: (prompt: string) => Promise<string>;
}): Promise<string | null> {
  if (!opts.enabled) {
    return null;
  }

  const prompt = buildAutoSummaryPrompt({
    planJson: opts.planJson,
    recentTexts: opts.recentTexts,
  });
  const summary = await opts.summarize(prompt);

  const date = formatUtcDate(new Date());
  const fileName = `${date}_${opts.sessionId}.md`;
  const autoDir = join(opts.workspaceRoot, AUTO_DIR);
  await mkdir(autoDir, { recursive: true });

  const relativePath = `${AUTO_DIR}/${fileName}`;
  const absolutePath = join(autoDir, fileName);
  const body = `## Auto summary (session ${opts.sessionId})\n\n${summary}`;
  await writeFile(absolutePath, body, "utf8");

  await appendIndex(autoDir, {
    sessionId: opts.sessionId,
    path: relativePath,
    createdAt: new Date().toISOString(),
  });

  return summary;
}

function buildAutoSummaryPrompt(input: {
  planJson: unknown;
  recentTexts: string[];
}): string {
  const lines: string[] = [
    "Summarize this coding session for durable memory.",
    "Capture goals, decisions, files touched, and follow-ups.",
    "",
    `Plan JSON: ${JSON.stringify(input.planJson)}`,
    "",
    "Recent activity:",
  ];
  for (const text of input.recentTexts) {
    lines.push(`- ${text}`);
  }
  return lines.join("\n");
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function appendIndex(autoDir: string, entry: IndexEntry): Promise<void> {
  const indexPath = join(autoDir, INDEX_FILE);
  let entries: IndexEntry[] = [];
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      entries = parsed as IndexEntry[];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  entries.push(entry);
  await writeFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}
