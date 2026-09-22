import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { DocsToc } from "@/components/docs/toc";
import { mdxComponents } from "@/components/docs/mdx-components";
import { docExists, getAllSlugs, getDoc } from "@/lib/docs";

export const dynamicParams = false;

type PageProps = {
  params: Promise<{ slug: string[] }>;
};

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug: [slug] }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: parts } = await params;
  const slug = parts.join("/");
  if (!docExists(slug)) {
    return { title: "Not found" };
  }
  const doc = getDoc(slug);
  return {
    title: doc.frontmatter.title,
    description: doc.frontmatter.description,
  };
}

export default async function DocsSlugPage({ params }: PageProps) {
  const { slug: parts } = await params;
  const slug = parts.join("/");

  if (!docExists(slug)) {
    notFound();
  }

  const doc = getDoc(slug);

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
