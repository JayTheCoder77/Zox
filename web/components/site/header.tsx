import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/site/theme-toggle";

const SHARE_TEXT =
  "Zox is a local coding agent harness. An LLM with tools on your repo, wrapped in permissions, sandboxing, and sessions. BYOK.";
const SHARE_URL = "https://github.com/JayTheCoder77/Zox";
const SHARE_HREF = `https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`;

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
      <div className="mx-auto flex max-w-[900px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-base font-bold text-ink">
            zox
          </Link>
          <nav className="flex items-center gap-4 text-base font-medium">
            <Link href="/docs" className="text-ink hover:opacity-70">
              Docs
            </Link>
            <a
              href="https://github.com/JayTheCoder77/Zox"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink hover:opacity-70"
            >
              GitHub
            </a>
            <a
              href={SHARE_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink hover:opacity-70"
            >
              Share on X
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Button href="/#install" variant="primary">
            Get started
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
