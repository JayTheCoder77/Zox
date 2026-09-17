import { describe, expect, test } from "bun:test";
import { buildEnvironmentPrompt } from "./environment.ts";

describe("buildEnvironmentPrompt", () => {
  test("includes model id, paths, git, platform, and date", () => {
    const prompt = buildEnvironmentPrompt({
      model: "openai/gpt-4.1",
      workingDirectory: "/tmp/ws/.zox/worktrees/sess_1",
      workspaceRoot: "/tmp/ws",
      isGitRepo: true,
      platform: "darwin",
      date: "Wed Sep 16 2026",
    });
    expect(prompt).toContain("openai/gpt-4.1");
    expect(prompt).toContain(
      "Working directory: /tmp/ws/.zox/worktrees/sess_1",
    );
    expect(prompt).toContain("Workspace root folder: /tmp/ws");
    expect(prompt).toContain("Is directory a git repo: yes");
    expect(prompt).toContain("Platform: darwin");
    expect(prompt).toContain("Today's date: Wed Sep 16 2026");
  });
});
