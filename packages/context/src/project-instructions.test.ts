import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadProjectInstructions,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
} from "./project-instructions.ts";

describe("loadProjectInstructions", () => {
  test("loads AGENTS.md and ZOXX.md from the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-instr-"));
    await writeFile(join(root, "AGENTS.md"), "AGENTS BODY");
    await writeFile(join(root, "ZOXX.md"), "ZOXX BODY");
    const loaded = await loadProjectInstructions({ workspaceRoot: root });
    expect(loaded).toContain("AGENTS BODY");
    expect(loaded).toContain("ZOXX BODY");
  });

  test("skips missing default files", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-instr-"));
    await writeFile(join(root, "AGENTS.md"), "ONLY AGENTS");
    const loaded = await loadProjectInstructions({ workspaceRoot: root });
    expect(loaded).toBe("ONLY AGENTS");
  });

  test("appends extra instruction files relative to workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-instr-"));
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "RULES.md"), "EXTRA RULES");
    const loaded = await loadProjectInstructions({
      workspaceRoot: root,
      extraFiles: ["docs/RULES.md"],
    });
    expect(loaded).toContain("EXTRA RULES");
  });

  test("truncates oversized instruction files", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-instr-"));
    await writeFile(join(root, "AGENTS.md"), "x".repeat(100));
    const loaded = await loadProjectInstructions({
      workspaceRoot: root,
      maxChars: 10,
    });
    expect(loaded.length).toBe(10);
    expect(PROJECT_INSTRUCTIONS_MAX_CHARS).toBe(64 * 1024);
  });

  test("ignores extra files that escape the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-instr-"));
    const loaded = await loadProjectInstructions({
      workspaceRoot: root,
      extraFiles: ["../outside.md"],
    });
    expect(loaded).toBe("");
  });
});
