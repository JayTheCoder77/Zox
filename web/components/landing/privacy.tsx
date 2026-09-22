export function Privacy() {
  return (
    <section className="mx-auto max-w-[800px] px-4 py-8">
      <h2 className="mb-4 text-base font-bold text-ink">Built for privacy first</h2>
      <div className="space-y-2 text-base leading-normal text-body">
        <p>Zox does not host your code. Keys stay in your environment.</p>
        <p>
          The server runs on your machine. Session data lives in local SQLite.
        </p>
      </div>
    </section>
  );
}
