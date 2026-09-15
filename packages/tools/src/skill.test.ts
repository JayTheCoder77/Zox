import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { skillTool } from "./skill.ts";

let workspaceRoot = "";

const ctx = () => ({
  sandboxRoot: workspaceRoot,
  maxToolOutputChars: 32_000,
  session: { id: "s", workspaceRoot, agent: "build" },
});

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "zox-skill-tool-"));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("skill tool", () => {
  test("returns skill body when found", async () => {
    const dir = join(workspaceRoot, ".zox/skills", "helper");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nSkill instructions here.\n",
      "utf8",
    );
    const result = await skillTool.execute({ name: "helper" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Skill instructions here.");
  });

  test("returns error when skill is missing", async () => {
    const result = await skillTool.execute({ name: "missing" }, ctx());
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not found/i);
  });
});
