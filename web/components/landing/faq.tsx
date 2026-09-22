"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

const ITEMS = [
  {
    q: "What is Zox?",
    a: "Local coding agent harness with tools, permissions, and sandboxing.",
  },
  {
    q: "Do I need a Zox account?",
    a: "No. BYOK. No auth.",
  },
  {
    q: "How do I install?",
    a: "bun add -g zox-code, then zox --model …",
  },
  {
    q: "What models work?",
    a: "Anthropic, OpenAI, Google, Groq, OpenRouter, custom OpenAI-compatible.",
  },
  {
    q: "Does it edit my repo in place?",
    a: "Default is a git worktree under .zox/worktrees/. Use --sandbox host for in-place.",
  },
  {
    q: "Is it open source?",
    a: "Yes — MIT.",
  },
  {
    q: "How is this different from OpenCode / Claude Code?",
    a: "Same category; Zox uses its own hooks schema, worktree default, and Bun-first stack.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="mx-auto max-w-[800px] px-4 py-8 pb-16">
      <h2 className="mb-6 text-base font-bold text-ink">FAQ</h2>
      <ul className="m-0 list-none divide-y divide-hairline border-y border-hairline p-0">
        {ITEMS.map((item, index) => {
          const isOpen = open === index;
          return (
            <li key={item.q} className="bg-transparent">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 px-0 py-4 text-left"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : index)}
              >
                <span className="text-base font-medium text-ink">{item.q}</span>
                <span className="shrink-0 text-mute" aria-hidden>
                  {isOpen ? "−" : "+"}
                </span>
              </button>
              <div
                className={cn(
                  "overflow-hidden text-base leading-normal text-body",
                  isOpen ? "pb-4" : "hidden",
                )}
              >
                {item.a}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
