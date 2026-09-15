import { basename, dirname } from "node:path";
import type { Skill } from "./types.ts";

export function parseSkillMarkdown(raw: string, path: string): Skill {
  const defaultName = basename(dirname(path));
  const trimmed = raw.startsWith("\ufeff") ? raw.slice(1) : raw;
  if (!trimmed.startsWith("---")) {
    return {
      name: defaultName,
      description: "",
      body: raw,
      path,
    };
  }

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) {
    return {
      name: defaultName,
      description: "",
      body: raw,
      path,
    };
  }

  const frontmatter = trimmed.slice(4, end);
  let body = trimmed.slice(end + 4);
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  const { name, description } = parseFrontmatter(frontmatter, defaultName);
  return { name, description, body, path };
}

function parseFrontmatter(
  block: string,
  defaultName: string,
): { name: string; description: string } {
  let name = defaultName;
  let description = "";
  for (const line of block.split("\n")) {
    const match = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    const value = match[2]?.trim() ?? "";
    if (key === "name" && value.length > 0) {
      name = value;
    } else if (key === "description") {
      description = value;
    }
  }
  return { name, description };
}
