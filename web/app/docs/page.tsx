import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { DocsToc } from "@/components/docs/toc";
import { mdxComponents } from "@/components/docs/mdx-components";
import { docExists, getDoc } from "@/lib/docs";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs",
  description: "Zox documentation — local coding agent harness.",
};

export default async function DocsIndexPage() {
  if (!docExists("")) {
    return (
      <article className="docs-prose">
        <h1>Docs</h1>
        <p>
          Documentation content is not available yet. Check back shortly, or
          browse the{" "}
          <Link href="https://github.com/JayTheCoder77/Zox" target="_blank" rel="noopener noreferrer">
            repository
          </Link>
          .
        </p>
      </article>
    );
  }

  const doc = getDoc("");

  return (
    <div className="flex gap-10">
      <article className="docs-prose min-w-0 flex-1">
        <MDXRemote
          source={doc.content}
          components={mdxComponents}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
              rehypePlugins: [rehypeSlug],
            },
          }}
        />
      </article>
      <aside className="hidden w-48 shrink-0 lg:block">
        <div className="sticky top-20">
          <DocsToc headings={doc.headings} />
        </div>
      </aside>
    </div>
  );
}
