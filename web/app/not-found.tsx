import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[800px] px-4 py-24 font-mono">
      <p className="mb-4 text-base text-ink">404 — page not found</p>
      <p className="text-body">
        <Link href="/" className="underline-offset-4 hover:underline">
          Home
        </Link>
        {" · "}
        <Link href="/docs" className="underline-offset-4 hover:underline">
          Docs
        </Link>
      </p>
    </div>
  );
}
