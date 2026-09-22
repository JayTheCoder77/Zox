import { InstallSnippet } from "@/components/ui/install-snippet";

export function Hero() {
  return (
    <section className="mx-auto max-w-[900px] px-4 pb-8 pt-16">
      <h1 className="mb-4 text-[clamp(28px,4vw,38px)] font-bold leading-[1.5] text-ink">
        The local coding agent harness
      </h1>
      <p className="mb-8 max-w-[720px] text-base leading-normal text-body">
        Talk to an LLM that can read, edit, and run tools on your repo — with
        permissions, sandboxing, sessions, and observability. BYOK.
      </p>
      <InstallSnippet />
    </section>
  );
}
