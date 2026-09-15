import { describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoSummarize } from "./summarize.ts";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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
    const recentTexts = ["user asked for tests", "assistant added summarize.ts"];
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
    expect(index[0].sessionId).toBe(sessionId);
    expect(index[0].path).toBe(`.zox/memory/auto/${date}_${sessionId}.md`);
    expect(index[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
});
