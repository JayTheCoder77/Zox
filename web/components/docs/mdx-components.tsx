import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { MdxPre } from "@/components/ui/code-block";
import { cn } from "@/lib/cn";

function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function Anchor({
  href,
  children,
  ...rest
}: ComponentPropsWithoutRef<"a">) {
  if (href && isInternalHref(href)) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

function InlineCode({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"code">) {
  return (
    <code
      className={cn(
        "rounded-[4px] bg-surface-soft px-1.5 py-0.5 text-sm text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </code>
  );
}

type CalloutProps = {
  kind?: "note" | "warning";
  children?: ReactNode;
};

export function Callout({ kind = "note", children }: CalloutProps) {
  return (
    <aside
      className={cn(
        "my-4 rounded-[4px] border border-hairline p-4 text-body",
        kind === "warning" && "border-l-[2px] border-l-warning",
      )}
    >
      {children}
    </aside>
  );
}

type StepsProps = {
  children?: ReactNode;
};

export function Steps({ children }: StepsProps) {
  return <ol className="my-4 list-decimal space-y-2 pl-5">{children}</ol>;
}

export const mdxComponents = {
  a: Anchor,
  pre: MdxPre,
  code: InlineCode,
  Callout,
  Steps,
};
