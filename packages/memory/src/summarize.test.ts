import { describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoSummarize, buildAutoSummaryPrompt } from "./summarize.ts";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("buildAutoSummaryPrompt", () => {
  test("includes plan JSON, prior-state heading, compaction summaries, and truncated recent lines", () => {
    const longTurn = `KEEP-HEAD${"x".repeat(32_000)}TAIL-SHOULD-DROP`;
    const prompt = buildAutoSummaryPrompt({
      planJson: [
        { id: "p1", content: "unique-plan-goal", status: "in_progress" },
      ],
      priorStateMarkdown: "## Prior state (auto)\n- Goal: unique-prior-goal",
      compactionSummaries: ["COMPACT-SUMMARY-UNIQUE"],
      recentTexts: ["short recent line", longTurn],
    });

    expect(prompt).toContain("unique-plan-goal");
    expect(prompt).toContain("## Prior state");
    expect(prompt).toContain("unique-prior-goal");
    expect(prompt).toContain("COMPACT-SUMMARY-UNIQUE");
    expect(prompt).toContain("short recent line");
    expect(prompt).toContain("KEEP-HEAD");
    expect(prompt).not.toContain("TAIL-SHOULD-DROP");
  });
});

describe("autoSummarize", () => {
  test("returns null and writes nothing when disabled", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-mem-sum-"));
    let called = false;
    const result = await autoSummarize({
      enabled: false,
      workspaceRoot,
      sessionId: "sess-1",
      planJson: [{ id: "1", content: "task", status: "done" }],
      recentTexts: ["fixed the bug"],
      summarize: async () => {
        called = true;
        return "ignored";
      },
    });

    expect(result).toBeNull();
    expect(called).toBe(false);
    expect(
      await pathExists(join(workspaceRoot, ".zox/memory/auto/index.json")),
    ).toBe(false);
  });

  test("writes markdown and appends index.json when enabled", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-mem-sum-"));
    const sessionId = "abc123";
    const planJson = [{ id: "1", content: "ship feature", status: "done" }];
    const recentTexts = [
      "user asked for tests",
      "assistant added summarize.ts",
    ];
    let capturedPrompt = "";

    const summary = await autoSummarize({
      enabled: true,
      workspaceRoot,
      sessionId,
      planJson,
      recentTexts,
      summarize: async (prompt) => {
        capturedPrompt = prompt;
        return "- Shipped auto-summarize\n- Files: summarize.ts";
      },
    });

    expect(summary).toBe("- Shipped auto-summarize\n- Files: summarize.ts");
    expect(capturedPrompt).toContain("ship feature");
    expect(capturedPrompt).toContain("user asked for tests");

    const autoDir = join(workspaceRoot, ".zox/memory/auto");
    const date = new Date().toISOString().slice(0, 10);
    const mdPath = join(autoDir, `${date}_${sessionId}.md`);
    const md = await readFile(mdPath, "utf8");
    expect(md).toBe(
      `## Auto summary (session ${sessionId})\n\n- Shipped auto-summarize\n- Files: summarize.ts`,
    );

    const indexRaw = await readFile(join(autoDir, "index.json"), "utf8");
    const index = JSON.parse(indexRaw) as Array<{
      sessionId: string;
      path: string;
      createdAt: string;
    }>;
    expect(index).toHaveLength(1);
    const entry = index[0];
    expect(entry).toBeDefined();
    expect(entry?.sessionId).toBe(sessionId);
    expect(entry?.path).toBe(`.zox/memory/auto/${date}_${sessionId}.md`);
    expect(entry?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("appends multiple entries to index.json", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-mem-sum-"));
    const summarize = async () => "summary body";

    await autoSummarize({
      enabled: true,
      workspaceRoot,
      sessionId: "first",
      planJson: [],
      recentTexts: [],
      summarize,
    });
    await autoSummarize({
      enabled: true,
      workspaceRoot,
      sessionId: "second",
      planJson: [],
      recentTexts: [],
      summarize,
    });

    const indexRaw = await readFile(
      join(workspaceRoot, ".zox/memory/auto/index.json"),
      "utf8",
    );
    const index = JSON.parse(indexRaw) as Array<{ sessionId: string }>;
    expect(index.map((e) => e.sessionId)).toEqual(["first", "second"]);
  });

  test("merges bullets into rolling-summary.md and dedupes trimmed lines", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "zox-mem-roll-"));
    const rollingPath = join(workspaceRoot, ".zox/memory/rolling-summary.md");

    await autoSummarize({
      enabled: true,
      workspaceRoot,
      sessionId: "roll-1",
      planJson: [],
      recentTexts: [],
      rollingSummary: true,
      summarize: async () => "- First fact\n- Second fact\n",
    });

    const first = await readFile(rollingPath, "utf8");
    expect(first).toContain("First fact");
    expect(first).toContain("Second fact");

    await autoSummarize({
      enabled: true,
      workspaceRoot,
      sessionId: "roll-2",
      planJson: [],
      recentTexts: [],
      rollingSummary: true,
      summarize: async () => "-   First fact  \n- Third fact\n",
    });

    const second = await readFile(rollingPath, "utf8");
    expect(second.match(/First fact/g)?.length).toBe(1);
    expect(second).toContain("Second fact");
    expect(second).toContain("Third fact");
  });
});
