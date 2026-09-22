"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const USER_PROMPT = "add a dry-run flag to the CLI";
const ASSISTANT =
  "I'll explore the CLI entrypoint and add a --dry-run flag…";

const TOOLS = [
  { text: '○ read packages/cli/src/index.ts', active: false },
  { text: '○ grep --pattern "flags"', active: false },
  { text: "● edit packages/cli/src/parse.ts", active: true },
] as const;

const PERMISSION = "Permission: allow write?  [y] / n";

type Phase =
  | "idle"
  | "typing"
  | "assistant"
  | "tools"
  | "permission"
  | "done";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TuiMock() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState("");
  const [toolCount, setToolCount] = useState(0);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showPermission, setShowPermission] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    function finishImmediately() {
      setTyped(USER_PROMPT);
      setShowAssistant(true);
      setToolCount(TOOLS.length);
      setShowPermission(true);
      setPhase("done");
    }

    function runSequence() {
      if (started.current) return;
      started.current = true;

      if (prefersReducedMotion()) {
        finishImmediately();
        return;
      }

      setPhase("typing");
      let i = 0;
      const typeInterval = window.setInterval(() => {
        i += 1;
        setTyped(USER_PROMPT.slice(0, i));
        if (i >= USER_PROMPT.length) {
          window.clearInterval(typeInterval);
          setPhase("assistant");
          window.setTimeout(() => {
            setShowAssistant(true);
            setPhase("tools");
            let t = 0;
            const toolInterval = window.setInterval(() => {
              t += 1;
              setToolCount(t);
              if (t >= TOOLS.length) {
                window.clearInterval(toolInterval);
                setPhase("permission");
                window.setTimeout(() => {
                  setShowPermission(true);
                  setPhase("done");
                }, 400);
              }
            }, 350);
          }, 400);
        }
      }, 40);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          runSequence();
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="mx-auto max-w-[900px] px-4 py-8">
      <div
        ref={rootRef}
        className="w-full overflow-hidden rounded-none border border-[rgba(253,252,252,0.12)] bg-[#201d1d] text-[#fdfcfc]"
        aria-label="Animated terminal mockup of a Zox session"
      >
        <div className="border-b border-[rgba(253,252,252,0.12)] px-4 py-3 text-sm">
          zox &nbsp;·&nbsp; anthropic/claude-sonnet-4 &nbsp;·&nbsp; worktree
        </div>
        <div className="space-y-3 px-4 py-4 text-sm leading-relaxed">
          <p>
            <span className="text-[#9a9898]">&gt; </span>
            {typed}
            {phase === "typing" ? (
              <span className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[2px] bg-[#fdfcfc] align-baseline animate-pulse" />
            ) : null}
          </p>

          {showAssistant ? <p className="text-[#c8c6c4]">{ASSISTANT}</p> : null}

          {TOOLS.slice(0, toolCount).map((tool) => (
            <p
              key={tool.text}
              className={cn(
                "pl-3",
                tool.active && "border-l-2 border-[#007aff]",
              )}
            >
              {tool.text}
            </p>
          ))}

          {showPermission ? (
            <p className="text-[#c8c6c4]">{PERMISSION}</p>
          ) : null}

          {phase === "done" ? (
            <p>
              <span className="text-[#9a9898]">&gt; </span>
              <span className="tui-cursor inline-block h-[1em] w-[0.55em] translate-y-[2px] bg-[#fdfcfc] align-baseline" />
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
