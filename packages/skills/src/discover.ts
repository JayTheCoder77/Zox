import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSkillMarkdown } from "./parse.ts";
import type { Skill, SkillDiscoveryOptions } from "./types.ts";

export function discoverSkills(opts: SkillDiscoveryOptions): Skill[] {
  const byName = new Map<string, Skill>();
  const sources = discoveryRoots(opts);
  for (const root of [...sources].reverse()) {
    for (const skill of scanSkillsRoot(root)) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkill(
  name: string,
  opts: SkillDiscoveryOptions,
): Skill | undefined {
  for (const root of discoveryRoots(opts)) {
    const path = join(root, name, "SKILL.md");
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    const skill = parseSkillMarkdown(raw, path);
    if (skill.name === name) {
      return skill;
    }
  }
  return undefined;
}

function discoveryRoots(opts: SkillDiscoveryOptions): string[] {
  const roots = [join(opts.workspaceRoot, ".zox/skills")];
  roots.push(join(homedir(), ".config/zox/skills"));
  if (opts.loadPaths) {
    for (const loadPath of opts.loadPaths) {
      roots.push(loadPath);
    }
  }
  return roots;
}

function scanSkillsRoot(root: string): Skill[] {
  const skills: Skill[] = [];
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, "SKILL.md");
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      skills.push(parseSkillMarkdown(raw, path));
    }
  } catch {
    return [];
  }
  return skills;
}
