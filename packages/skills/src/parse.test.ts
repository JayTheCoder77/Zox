import { describe, expect, test } from "bun:test";
import { parseSkillMarkdown } from "./parse.ts";

describe("parseSkillMarkdown", () => {
  test("parses optional YAML frontmatter", () => {
    const raw = `---
name: commit-helper
description: Conventional commits from diffs
---
# Commit helper

Use conventional commits.
`;
    const skill = parseSkillMarkdown(raw, "/ws/.zox/skills/commit-helper/SKILL.md");
    expect(skill).toEqual({
      name: "commit-helper",
      description: "Conventional commits from diffs",
      body: "# Commit helper\n\nUse conventional commits.\n",
      path: "/ws/.zox/skills/commit-helper/SKILL.md",
    });
  });

  test("defaults name from skill directory when frontmatter omits name", () => {
    const raw = "# My skill\n\nBody only.\n";
    const skill = parseSkillMarkdown(raw, "/tmp/.zox/skills/my-skill/SKILL.md");
    expect(skill.name).toBe("my-skill");
    expect(skill.description).toBe("");
    expect(skill.body).toBe("# My skill\n\nBody only.\n");
  });
});
