const STEPS = [
  "You type a request",
  "Optional prompt guardrail (Jev) can allow / ask / deny",
  "Model streams; may emit tool calls",
  "Each tool: permission → hooks → sandbox → execute",
  "Results return to the conversation; loop until done",
  "Usage, traces, transcript stored on the session",
];

const DIAGRAM = `You (TUI / REPL / SDK)
        │  HTTP + SSE
        ▼
   Zox server  ──► LLM provider
        │
        ├── tools
        ├── sandbox
        ├── hooks
        └── SQLite sessions`;

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[800px] px-4 py-8">
      <h2 className="mb-6 text-base font-bold text-ink">How it works</h2>
      <ol className="mb-8 list-decimal space-y-2 pl-5 text-base leading-normal text-body">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <pre className="overflow-x-auto rounded-[4px] border border-hairline bg-surface-soft p-4 text-sm leading-normal text-ink">
        {DIAGRAM}
      </pre>
    </section>
  );
}
