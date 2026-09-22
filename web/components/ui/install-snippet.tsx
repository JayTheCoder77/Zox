"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type TabId = "bun" | "bunx" | "pin";

const TABS: { id: TabId; label: string; code: string }[] = [
  {
    id: "bun",
    label: "bun",
    code: `bun add -g zox-code
zox --model openai/gpt-4.1`,
  },
  {
    id: "bunx",
    label: "bunx",
    code: `bunx zox-code --model openai/gpt-4.1`,
  },
  {
    id: "pin",
    label: "pin",
    code: `bun add -g zox-code@0.1.3
zox --model openai/gpt-4.1`,
  },
];

export function InstallSnippet() {
  const [active, setActive] = useState<TabId>("bun");
  const [copied, setCopied] = useState(false);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    bun: null,
    bunx: null,
    pin: null,
  });
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  useEffect(() => {
    const el = tabRefs.current[active];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      id="install"
      className="overflow-hidden rounded-[4px] border border-hairline bg-surface-soft"
    >
      <div className="relative flex items-center justify-between border-b border-hairline px-3">
        <div
          className="relative flex gap-4"
          role="tablist"
          aria-label="Install method"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              onClick={() => setActive(tab.id)}
              className={cn(
                "relative py-3 text-sm font-medium transition-colors duration-200",
                active === tab.id ? "text-ink" : "text-mute hover:text-ink",
              )}
            >
              {tab.label}
            </button>
          ))}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 h-0.5 bg-ink transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{ left: indicator.left, width: indicator.width }}
          />
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="py-3 text-sm font-medium text-ink hover:opacity-70"
          aria-label={copied ? "Copied" : "Copy install commands"}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-normal text-ink">
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
