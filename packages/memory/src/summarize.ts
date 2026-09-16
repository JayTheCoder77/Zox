import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const AUTO_DIR = ".zox/memory/auto";
const INDEX_FILE = "index.json";
const ROLLING_FILE = ".zox/memory/rolling-summary.md";
export const AUTO_SUMMARY_RECENT_TURN_MAX_CHARS = 32_000;

type IndexEntry = {
  sessionId: string;
  path: string;
  createdAt: string;
};

export type AutoSummaryPromptInput = {
  planJson: unknown;
  priorStateMarkdown?: string;
  compactionSummaries?: string[];
  recentTexts: string[];
  recentTurnMaxChars?: number;
};

export async function autoSummarize(opts: {
  enabled: boolean;
  workspaceRoot: string;
  sessionId: string;
  planJson: unknown;
  priorStateMarkdown?: string;
  compactionSummaries?: string[];
  recentTexts: string[];
  rollingSummary?: boolean;
  summarize: (prompt: string) => Promise<string>;
}): Promise<string | null> {
  if (!opts.enabled) {
    return null;
  }

  const prompt = buildAutoSummaryPrompt({
    planJson: opts.planJson,
    priorStateMarkdown: opts.priorStateMarkdown,
    compactionSummaries: opts.compactionSummaries,
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

  if (opts.rollingSummary === true) {
    await mergeRollingSummary(join(opts.workspaceRoot, ROLLING_FILE), summary);
  }

  return summary;
}

export function buildAutoSummaryPrompt(input: AutoSummaryPromptInput): string {
  const maxChars =
    input.recentTurnMaxChars ?? AUTO_SUMMARY_RECENT_TURN_MAX_CHARS;
  const lines: string[] = [
    "Summarize this coding session for durable memory.",
    "Capture goals, decisions, files touched, and follow-ups.",
    "",
    `Plan JSON: ${JSON.stringify(input.planJson)}`,
  ];

  const prior = input.priorStateMarkdown?.trim();
  if (prior) {
    lines.push("", "## Prior state", "", prior);
  }

  const compact = (input.compactionSummaries ?? []).filter((s) => s.trim());
  if (compact.length > 0) {
    lines.push("", "## Compaction summaries");
    for (const summary of compact) {
      lines.push(`- ${summary}`);
    }
  }

  lines.push("", "Recent activity:");
  for (const text of input.recentTexts) {
    lines.push(`- ${truncateText(text, maxChars)}`);
  }
  return lines.join("\n");
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
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

async function mergeRollingSummary(
  rollingPath: string,
  summary: string,
): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(rollingPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of existing.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const key = bulletHash(line);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(canonicalizeBullet(line));
  }

  for (const line of extractBulletLines(summary)) {
    const key = bulletHash(line);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(canonicalizeBullet(line));
  }

  await mkdir(dirname(rollingPath), { recursive: true });
  const body = kept.length > 0 ? `${kept.join("\n")}\n` : "";
  await writeFile(rollingPath, body, "utf8");
}

function extractBulletLines(markdown: string): string[] {
  const bullets: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*[-*]\s+\S/.test(line)) {
      bullets.push(line);
    }
  }
  return bullets;
}

function bulletContent(line: string): string {
  return line.replace(/^\s*[-*]\s+/, "").trim();
}

function canonicalizeBullet(line: string): string {
  return `- ${bulletContent(line)}`;
}

function bulletHash(line: string): string {
  return createHash("sha256").update(bulletContent(line)).digest("hex");
}
