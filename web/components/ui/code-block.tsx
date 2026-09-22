"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type CodeBlockProps = {
  code: string;
  language?: string;
  className?: string;
};

export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[4px] border border-hairline bg-surface-soft",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2 text-sm text-stone">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="font-medium text-ink hover:opacity-70"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-normal text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

type MdxCodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
};

export function MdxPre({ children, className }: MdxCodeBlockProps) {
  const child = Array.isArray(children) ? children[0] : children;
  if (
    child &&
    typeof child === "object" &&
    "props" in child &&
    child.props &&
    typeof child.props === "object"
  ) {
    const props = child.props as {
      children?: React.ReactNode;
      className?: string;
    };
    const raw = props.children;
    const code =
      typeof raw === "string"
        ? raw.replace(/\n$/, "")
        : Array.isArray(raw)
          ? raw.join("").replace(/\n$/, "")
          : String(raw ?? "");
    const langMatch = /language-([\w-]+)/.exec(
      props.className || className || "",
    );
    return <CodeBlock code={code} language={langMatch?.[1]} />;
  }

  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-[4px] border border-hairline bg-surface-soft p-4 text-sm",
        className,
      )}
    >
      {children}
    </pre>
  );
}
