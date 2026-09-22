import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "content/docs");

export type DocFrontmatter = {
  title: string;
  description: string;
};

export type DocHeading = {
  depth: 2 | 3;
  text: string;
  id: string;
};

export type Doc = {
  frontmatter: DocFrontmatter;
  content: string;
  headings: DocHeading[];
};

/** Match rehype-slug: lowercase, strip punctuation, spaces to hyphens. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function extractHeadings(content: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const lines = content.split("\n");
  let inFence = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!match) continue;

    const depth = match[1].length as 2 | 3;
    const text = match[2]
      .replace(/#+\s*$/, "")
      .replace(/`/g, "")
      .trim();
    headings.push({ depth, text, id: slugifyHeading(text) });
  }

  return headings;
}

function resolveDocPath(slug: string): string {
  const file = slug ? `${slug}.mdx` : "index.mdx";
  return path.join(CONTENT_DIR, file);
}

export function getAllSlugs(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) {
    return [];
  }

  return fs
    .readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith(".mdx") && name !== "index.mdx")
    .map((name) => name.replace(/\.mdx$/, ""));
}

export function getDoc(slug: string): Doc {
  const filePath = resolveDocPath(slug);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Doc not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  return {
    frontmatter: {
      title: typeof data.title === "string" ? data.title : slug || "Overview",
      description:
        typeof data.description === "string" ? data.description : "",
    },
    content,
    headings: extractHeadings(content),
  };
}

export function docExists(slug: string): boolean {
  return fs.existsSync(resolveDocPath(slug));
}
