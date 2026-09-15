import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, findSkill } from "./discover.ts";

let workspaceRoot = "";
let extraLoadPath = "";

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "zox-skills-ws-"));
  extraLoadPath = await mkdtemp(join(tmpdir(), "zox-skills-load-"));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(extraLoadPath, { recursive: true, force: true });
});

async function writeSkill(
  root: string,
  folder: string,
  content: string,
): Promise<void> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf8");
}

describe("discoverSkills", () => {
  test("loads SKILL.md from workspace .zox/skills", async () => {
    await writeSkill(
      join(workspaceRoot, ".zox/skills"),
      "demo",
      "---\nname: demo\n---\n# Demo\n",
    );
    const skills = discoverSkills({ workspaceRoot });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("demo");
    expect(skills[0]?.body).toContain("# Demo");
  });

  test("findSkill prefers workspace over loadPaths", async () => {
    await writeSkill(
      join(workspaceRoot, ".zox/skills"),
      "pick",
      "---\nname: pick\ndescription: workspace\n---\nworkspace body\n",
    );
    await writeSkill(
      extraLoadPath,
      "pick",
      "---\nname: pick\ndescription: extra\n---\nextra body\n",
    );
    const found = findSkill("pick", {
      workspaceRoot,
      loadPaths: [extraLoadPath],
    });
    expect(found?.description).toBe("workspace");
    expect(found?.body).toContain("workspace body");
  });
});
