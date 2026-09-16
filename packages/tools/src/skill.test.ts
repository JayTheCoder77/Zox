import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  test("returns short ack when found", async () => {
    const dir = join(workspaceRoot, ".zox/skills", "helper");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nSkill instructions here.\n",
      "utf8",
    );
    const result = await skillTool.execute({ name: "helper" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/helper/i);
    expect(result.content).not.toContain("Skill instructions here.");
  });

  test("returns error when skill is missing", async () => {
    const result = await skillTool.execute({ name: "missing" }, ctx());
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not found/i);
  });

  test("calls activateSkill and does not echo the full body", async () => {
    const dir = join(workspaceRoot, ".zox/skills", "helper");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nLONG BODY INSTRUCTIONS\n",
      "utf8",
    );
    const activated: string[] = [];
    const result = await skillTool.execute(
      { name: "helper" },
      {
        ...ctx(),
        activateSkill: (skill) => {
          activated.push(skill.name);
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(activated).toEqual(["helper"]);
    expect(result.content).toMatch(/helper/i);
    expect(result.content).not.toContain("LONG BODY INSTRUCTIONS");
  });

  test("uses loadPaths when finding skills", async () => {
    const extra = await mkdtemp(join(tmpdir(), "zox-skill-extra-"));
    const dir = join(extra, "from-path");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: from-path\ndescription: extra\n---\nbody\n",
      "utf8",
    );
    const result = await skillTool.execute(
      { name: "from-path" },
      { ...ctx(), loadPaths: [extra] },
    );
    expect(result.ok).toBe(true);
    await rm(extra, { recursive: true, force: true });
  });
});
