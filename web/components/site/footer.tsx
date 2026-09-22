import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-hairline">
      <div className="mx-auto max-w-[900px] px-4 py-8 text-sm leading-relaxed text-stone">
        <p className="mb-2 font-medium text-mute">zox</p>
        <p className="mb-2">
          <Link href="/docs" className="hover:text-ink">
            Docs
          </Link>
          {" · "}
          <a
            href="https://github.com/JayTheCoder77/Zox"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink"
          >
            GitHub
          </a>
          {" · "}
          <a
            href="https://github.com/JayTheCoder77/Zox/tree/main/spec"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink"
          >
            Spec
          </a>
        </p>
        <p>MIT · Local-first coding harness</p>
      </div>
    </footer>
  );
}
