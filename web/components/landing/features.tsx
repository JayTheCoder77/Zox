import Link from "next/link";
import { AsciiList } from "@/components/ui/ascii-list";

const FEATURES = [
  {
    mark: "+" as const,
    title: "Local-first",
    body: "Server binds 127.0.0.1; you own the keys",
  },
  {
    mark: "+" as const,
    title: "Worktree sandbox",
    body: "Default isolation via git worktree",
  },
  {
    mark: "+" as const,
    title: "Permissions",
    body: "Approve writes and shell before they run",
  },
  {
    mark: "+" as const,
    title: "BYOK providers",
    body: "Anthropic, OpenAI, Google, Groq, OpenRouter, …",
  },
  {
    mark: "+" as const,
    title: "MCP + skills",
    body: "Extend tools and reusable SKILL.md packs",
  },
  {
    mark: "+" as const,
    title: "TUI + SDK",
    body: "Ink terminal UI and typed @zox/sdk client",
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-[800px] px-4 py-8">
      <h2 className="mb-6 text-base font-bold text-ink">What is Zox?</h2>
      <div className="mb-8 space-y-4 text-base leading-normal text-body">
        <p>
          Zox is a coding agent harness. The model does not “have” your repo —
          the harness holds the session, assembles context, streams the model,
          runs tools under policy, and records traces.
        </p>
        <p>
          It is not a hosted chat product. The agent loop lives on your machine.
        </p>
      </div>
      <AsciiList rows={FEATURES} className="mb-8" />
      <Link
        href="/docs"
        className="text-base font-medium text-ink underline-offset-4 hover:underline"
      >
        Read docs →
      </Link>
    </section>
  );
}
